import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errors } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSession } from '../src/tools/checkSession.js';

const validState = JSON.stringify({ cookies: [], origins: [] });

function fakeBrowser(navigate) {
  const contexts = [];
  return {
    contexts,
    newContext: vi.fn(async () => {
      const context = {
        close: vi.fn(async () => {}),
        newPage: async () => {
          let current = 'about:blank';
          return {
            goto: async (url) => {
              current = await navigate(url);
            },
            waitForLoadState: async () => {},
            url: () => current,
          };
        },
      };
      contexts.push(context);
      return context;
    }),
  };
}

describe('checkSession', () => {
  let dir;
  let config;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cesibridge-'));
    config = {
      entUrl: 'https://ent.example.fr/',
      loggedInHosts: ['ent.example.fr'],
      statePath: join(dir, 'state.json'),
      navTimeoutMs: 1000,
    };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('session absente : ne lance pas le navigateur', async () => {
    const getBrowser = vi.fn();

    const result = await checkSession({ config, getBrowser });

    expect(result.status).toBe('absent');
    expect(getBrowser).not.toHaveBeenCalled();
  });

  it('state corrompu : invalid', async () => {
    await writeFile(config.statePath, 'nope');

    const result = await checkSession({ config, getBrowser: vi.fn() });

    expect(result.status).toBe('invalid');
  });

  it('valide si l’ENT ne redirige pas, et ferme le contexte', async () => {
    await writeFile(config.statePath, validState);
    const browser = fakeBrowser(async (url) => url);

    const result = await checkSession({ config, getBrowser: async () => browser });

    expect(result.status).toBe('valid');
    expect(browser.contexts[0].close).toHaveBeenCalledOnce();
  });

  it('expirée si redirigé vers le SSO', async () => {
    await writeFile(config.statePath, validState);
    const browser = fakeBrowser(async () => 'https://sso.example.fr/login?ticket=SECRET');

    const result = await checkSession({ config, getBrowser: async () => browser });

    expect(result.status).toBe('expired');
    expect(result.message).not.toContain('SECRET');
  });

  it('timeout réseau : erreur propre, sans message brut', async () => {
    await writeFile(config.statePath, validState);
    const browser = fakeBrowser(async () => {
      throw new errors.TimeoutError('page.goto: Timeout https://sso.example.fr/?token=SECRET');
    });

    const result = await checkSession({ config, getBrowser: async () => browser });

    expect(result).toEqual({ status: 'error', message: expect.stringContaining('délai') });
    expect(result.message).not.toContain('SECRET');
    expect(browser.contexts[0].close).toHaveBeenCalledOnce();
  });

  it('deux appels parallèles utilisent chacun leur contexte', async () => {
    await writeFile(config.statePath, validState);
    const browser = fakeBrowser(async (url) => url);
    const deps = { config, getBrowser: async () => browser };

    const results = await Promise.all([checkSession(deps), checkSession(deps)]);

    expect(results.map((r) => r.status)).toEqual(['valid', 'valid']);
    expect(browser.newContext).toHaveBeenCalledTimes(2);
  });
});

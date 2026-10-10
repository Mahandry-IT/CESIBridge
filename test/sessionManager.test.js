import { describe, expect, it, vi } from 'vitest';
import { createSessionManager, LoginRequiredError } from '../src/browser/sessionManager.js';

const config = {
  entUrl: 'https://ent.example.fr/',
  loggedInHosts: ['ent.example.fr'],
  statePath: 'state.json',
  navTimeoutMs: 1000,
  loginTimeoutMs: 1000,
};
const credentials = { email: 'etu@example.fr' };
Object.defineProperty(credentials, 'password', { value: 'motdepasse' });

/** Faux navigateur : chaque contexte retient le state avec lequel il a été créé. */
function fakeBrowser() {
  const contexts = [];
  return {
    contexts,
    newContext: async (options = {}) => {
      const context = {
        state: options.storageState ?? null,
        closed: false,
        request: { id: contexts.length },
        newPage: async () => ({ context }),
        close: async () => {
          context.closed = true;
        },
      };
      contexts.push(context);
      return context;
    },
  };
}

function setup({
  state = { cookies: [], origins: [] },
  valid = true,
  withCredentials = true,
} = {}) {
  const browser = fakeBrowser();
  const store = { state };
  const login = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.state = { cookies: ['neuf'], origins: [] };
    return 'ent.example.fr';
  });
  const check = vi.fn(async (page) => ({ loggedIn: valid && page.context.state === state }));
  const save = vi.fn(async () => ({ cookies: 1 }));
  const manager = createSessionManager({
    getBrowser: async () => browser,
    config,
    credentials: withCredentials ? credentials : null,
    login,
    check,
    load: async () => store.state,
    save,
  });
  return { manager, browser, login, check, save };
}

describe('createSessionManager', () => {
  it('réutilise une session valide sans login, enregistre puis ferme le contexte', async () => {
    const { manager, browser, login, save } = setup();

    const result = await manager.withContext(async (session) => {
      expect(session.context.closed).toBe(false);
      return 42;
    });

    expect(result).toBe(42);
    expect(login).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(browser.contexts.every((context) => context.closed)).toBe(true);
  });

  it('session expirée : login dans un contexte neuf, puis contexte depuis la nouvelle session', async () => {
    const { manager, browser, login } = setup({ valid: false });

    const state = await manager.withContext(async (session) => session.context.state);

    expect(login).toHaveBeenCalledTimes(1);
    expect(state).toEqual({ cookies: ['neuf'], origins: [] });
    // Contexte expiré, contexte de login (sans state), contexte de travail.
    expect(browser.contexts.map((context) => context.state?.cookies ?? null)).toEqual([
      [],
      null,
      ['neuf'],
    ]);
  });

  it('session absente : login sans vérification préalable', async () => {
    const { manager, login, check } = setup({ state: null });

    await manager.withContext(async () => {});

    expect(check).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('deux appels concurrents sur une session expirée : un seul login', async () => {
    const { manager, login } = setup({ valid: false });

    await Promise.all([manager.withContext(async () => {}), manager.withContext(async () => {})]);

    expect(login).toHaveBeenCalledTimes(1);
  });

  it('sans identifiants : LoginRequiredError', async () => {
    const { manager, login } = setup({ valid: false, withCredentials: false });

    await expect(manager.withContext(async () => {})).rejects.toBeInstanceOf(LoginRequiredError);
    expect(login).not.toHaveBeenCalled();
  });

  it('renew() remplace le contexte courant après un login', async () => {
    const { manager, login } = setup();

    await manager.withContext(async (session) => {
      const first = session.context;
      const renewed = await session.renew();

      expect(first.closed).toBe(true);
      expect(renewed).toBe(session.context);
      expect(renewed.state).toEqual({ cookies: ['neuf'], origins: [] });
    });
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('erreur de la fonction : pas d’enregistrement, contexte fermé', async () => {
    const { manager, browser, save } = setup();

    await expect(
      manager.withContext(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(save).not.toHaveBeenCalled();
    expect(browser.contexts.every((context) => context.closed)).toBe(true);
  });
});

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserProvider, loadState, saveState, StateError } from '../src/browser/session.js';

const state = {
  cookies: [
    { name: 'sid', value: 'x', expires: -1 },
    { name: 'pref', value: 'y', expires: 2_000_000_000 },
  ],
  origins: [],
};

describe('loadState / saveState', () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cesibridge-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('renvoie null si le fichier n’existe pas', async () => {
    await expect(loadState(join(dir, 'absent.json'))).resolves.toBeNull();
  });

  it('lève StateError sur un JSON corrompu', async () => {
    const path = join(dir, 'state.json');
    await writeFile(path, '{oops');

    await expect(loadState(path)).rejects.toBeInstanceOf(StateError);
  });

  it('lève StateError si la structure est invalide', async () => {
    const path = join(dir, 'state.json');
    await writeFile(path, JSON.stringify({ cookies: 'nope' }));

    await expect(loadState(path)).rejects.toBeInstanceOf(StateError);
  });

  it('écrit le state (dossier créé) et le relit à l’identique', async () => {
    const path = join(dir, 'nested', 'state.json');
    const context = { storageState: async () => state };

    const counts = await saveState(context, path);

    expect(counts).toEqual({ cookies: 2, sessionCookies: 1 });
    await expect(loadState(path)).resolves.toEqual(state);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(state);
  });

  it.skipIf(process.platform === 'win32')('restreint les droits à 600', async () => {
    const path = join(dir, 'state.json');
    await saveState({ storageState: async () => state }, path);

    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});

function fakeBrowser() {
  const browser = new EventEmitter();
  browser.close = vi.fn(async () => browser.emit('disconnected'));
  return browser;
}

describe('createBrowserProvider', () => {
  it('ne lance qu’un navigateur pour des appels parallèles', async () => {
    const launch = vi.fn(async () => fakeBrowser());
    const provider = createBrowserProvider(launch);

    const [a, b] = await Promise.all([provider.get(), provider.get()]);

    expect(a).toBe(b);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('relance après un échec de lancement', async () => {
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(fakeBrowser());
    const provider = createBrowserProvider(launch);

    await expect(provider.get()).rejects.toThrow('boom');
    await expect(provider.get()).resolves.toBeDefined();
  });

  it('relance après une déconnexion et ferme proprement', async () => {
    const launch = vi.fn(async () => fakeBrowser());
    const provider = createBrowserProvider(launch);
    const first = await provider.get();

    first.emit('disconnected');
    const second = await provider.get();
    await provider.close();

    expect(second).not.toBe(first);
    expect(second.close).toHaveBeenCalledOnce();
  });
});

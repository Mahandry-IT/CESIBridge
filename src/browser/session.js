import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

export class StateError extends Error {
  name = 'StateError';
}

/** Lit le storageState. Renvoie `null` s'il n'existe pas, lève `StateError` s'il est illisible. */
export async function loadState(statePath) {
  let raw;
  try {
    raw = await readFile(statePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new StateError(`storageState illisible (${error.code ?? error.message})`);
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    throw new StateError('storageState corrompu (JSON invalide)');
  }
  if (!Array.isArray(state?.cookies) || !Array.isArray(state?.origins)) {
    throw new StateError('storageState invalide (cookies/origins manquants)');
  }
  return state;
}

/**
 * Écrit le storageState du contexte avec des droits restreints (600), de façon atomique.
 * Renvoie des compteurs seulement : jamais de valeur de cookie.
 */
export async function saveState(context, statePath) {
  const state = await context.storageState();
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  // Nom temporaire unique : deux enregistrements concurrents ne partagent pas le même fichier.
  const tmpPath = `${statePath}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(state), { mode: 0o600 });
  await rename(tmpPath, statePath);
  return {
    cookies: state.cookies.length,
    sessionCookies: state.cookies.filter((cookie) => cookie.expires === -1).length,
  };
}

export function launchBrowser({ headless }) {
  return chromium.launch({ headless });
}

/**
 * Navigateur partagé, lancé à la demande. Chaque appel crée son propre contexte :
 * pas de verrou, appels parallèles possibles.
 */
export function createBrowserProvider(launch) {
  let pending = null;
  return {
    get() {
      if (pending) return pending;
      // Ne réinitialise que si `pending` désigne encore ce lancement (pas un relancement ultérieur).
      const launching = launch().then(
        (browser) => {
          browser.on('disconnected', () => {
            if (pending === launching) pending = null;
          });
          return browser;
        },
        (error) => {
          if (pending === launching) pending = null;
          throw error;
        },
      );
      pending = launching;
      return launching;
    },
    async close() {
      const current = pending;
      pending = null;
      const browser = await current?.catch(() => null);
      await browser?.close();
    },
  };
}

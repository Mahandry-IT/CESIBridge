import { autoLogin, checkLoggedIn } from './sso.js';
import { loadState, saveState } from './session.js';
import { log } from '../log.js';

/** Session absente ou expirée, sans identifiants pour se reconnecter seul. */
export class LoginRequiredError extends Error {
  name = 'LoginRequiredError';
}

/**
 * Gestion de session partagée (sync et serveur MCP).
 * `withContext(fn)` ouvre un contexte connecté, exécute `fn(session)`, enregistre la session, ferme.
 * `session.context` et `session.page` désignent le contexte courant ; `session.renew()` se reconnecte
 * et remplace le contexte (nouvel essai après une session expirée en cours de route).
 * Une seule reconnexion à la fois dans le processus : les appels concurrents partagent la même promesse.
 */
export function createSessionManager({
  getBrowser,
  config,
  credentials = null,
  login = autoLogin,
  check = checkLoggedIn,
  load = loadState,
  save = saveState,
}) {
  let pendingLogin = null;

  async function doRelogin() {
    if (!credentials) throw new LoginRequiredError('session absente ou expirée');
    log('Session absente ou expirée : login automatique.');
    // Contexte neuf : un contexte expiré garde un stockage local qui renvoie l'ENT vers le login.
    const browser = await getBrowser();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const host = await login(page, {
        entUrl: config.entUrl,
        loggedInHosts: config.loggedInHosts,
        timeoutMs: config.loginTimeoutMs,
        credentials,
      });
      const { cookies } = await save(context, config.statePath);
      log(`Connecté (${host}). Session enregistrée : ${cookies} cookies.`);
    } finally {
      await context.close().catch(() => {});
    }
  }

  function relogin() {
    pendingLogin ??= doRelogin().finally(() => {
      pendingLogin = null;
    });
    return pendingLogin;
  }

  async function openContext(state) {
    const browser = await getBrowser();
    const context = await browser.newContext({ storageState: state });
    try {
      return { context, page: await context.newPage() };
    } catch (error) {
      await context.close().catch(() => {});
      throw error;
    }
  }

  // Contexte depuis la session enregistrée, vérifiée sur l'ENT ; `null` si absente ou expirée.
  async function openSavedContext() {
    const state = await load(config.statePath);
    if (!state) return null;
    const opened = await openContext(state);
    try {
      const { loggedIn } = await check(opened.page, {
        entUrl: config.entUrl,
        loggedInHosts: config.loggedInHosts,
        timeoutMs: config.navTimeoutMs,
      });
      if (loggedIn) return opened;
    } catch (error) {
      await opened.context.close().catch(() => {});
      throw error;
    }
    await opened.context.close().catch(() => {});
    return null;
  }

  async function openAfterLogin() {
    await relogin();
    const state = await load(config.statePath);
    if (!state) throw new LoginRequiredError('session introuvable après le login');
    return openContext(state);
  }

  async function withContext(fn) {
    const session = (await openSavedContext()) ?? (await openAfterLogin());
    session.renew = async () => {
      await session.context.close().catch(() => {});
      Object.assign(session, await openAfterLogin());
      return session.context;
    };
    try {
      const result = await fn(session);
      // Cookies éventuellement rafraîchis pendant l'opération : on garde la version la plus récente.
      await save(session.context, config.statePath);
      return result;
    } finally {
      await session.context.close().catch(() => {});
    }
  }

  return { withContext, relogin };
}

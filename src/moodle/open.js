import { autoLogin, hostOf, isLoggedInHost } from '../browser/sso.js';
import { LoginRequiredError } from '../browser/sessionManager.js';
import { isMoodleUrl, MOODLE_HOST } from './constants.js';
import { MoodleError } from './errors.js';

// Texte du lien ENT, sans dépendre du numéro (« 31 - »).
const ENT_LINK_TEXT = /Moodle One Cesi/i;
const SESSKEY_PATTERN = /^[A-Za-z0-9]{1,64}$/;
const SETTLE_TIMEOUT_MS = 10_000;

/** URL d'accès Moodle : celle de la config, sinon le `href` (fixe) du lien ENT. */
export async function resolveMoodleUrl(page, { moodleUrl, entUrl, timeoutMs }) {
  if (moodleUrl) return moodleUrl;
  await page.goto(entUrl, { waitUntil: 'load', timeout: timeoutMs });
  const href = await page
    .getByRole('link', { name: ENT_LINK_TEXT })
    .first()
    .getAttribute('href', { timeout: timeoutMs })
    .catch(() => null);
  const url = href && new URL(href, entUrl).href;
  if (!url || !isMoodleUrl(url)) {
    throw new MoodleError('lien Moodle introuvable sur l’ENT : définir CESI_MOODLE_URL');
  }
  return url;
}

/** Lit `M.cfg` sur une page Moodle connectée. La sesskey n'est jamais journalisée ni renvoyée. */
export async function readMoodleConfig(page) {
  const cfg = await page
    .evaluate(() => {
      // Exécuté dans la page : `M` est l'objet global de Moodle.
      const cfg = globalThis.M?.cfg;
      return cfg ? { sesskey: cfg.sesskey, wwwroot: cfg.wwwroot } : null;
    })
    .catch(() => null);
  if (!cfg || typeof cfg.sesskey !== 'string' || !SESSKEY_PATTERN.test(cfg.sesskey)) {
    throw new MoodleError('sesskey Moodle absente');
  }
  if (!isMoodleUrl(cfg.wwwroot)) throw new MoodleError('wwwroot Moodle inattendu');
  return { sesskey: cfg.sesskey, wwwroot: new URL(cfg.wwwroot).origin };
}

/**
 * Ouvre Moodle dans le contexte (SSO CAS via le lien d'accès). Si le SSO redemande une connexion,
 * `autoLogin` la traite quand les identifiants sont disponibles ; sinon `LoginRequiredError`.
 * @returns {Promise<{ page, sesskey: string, wwwroot: string, accessUrl: string }>}
 */
export async function openMoodle(
  context,
  { moodleUrl, entUrl, navTimeoutMs, loginTimeoutMs, credentials },
) {
  const page = await context.newPage();
  const url = await resolveMoodleUrl(page, { moodleUrl, entUrl, timeoutMs: navTimeoutMs });
  await page.goto(url, { waitUntil: 'load', timeout: navTimeoutMs });
  await page
    .waitForLoadState('networkidle', { timeout: Math.min(navTimeoutMs, SETTLE_TIMEOUT_MS) })
    .catch(() => {});
  if (!isLoggedInHost(page.url(), [MOODLE_HOST])) {
    if (!credentials) {
      throw new LoginRequiredError(`connexion Moodle requise (hôte ${hostOf(page.url())})`);
    }
    await autoLogin(page, {
      startUrl: url,
      loggedInHosts: [MOODLE_HOST],
      timeoutMs: loginTimeoutMs,
      credentials,
    });
  }
  return { page, accessUrl: url, ...(await readMoodleConfig(page)) };
}

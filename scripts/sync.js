// Synchronise l'emploi du temps CESI (N semaines) vers PostgreSQL.
// Réutilise le storageState ; se reconnecte automatiquement (un seul essai) si la session a expiré.
import { loadSyncConfig } from '../src/config.js';
import { launchBrowser, loadState, saveState } from '../src/browser/session.js';
import { autoLogin, checkLoggedIn } from '../src/browser/sso.js';
import { discoverCodePersonne } from '../src/schedule/codePersonne.js';
import { fetchWeekWithRetry } from '../src/schedule/client.js';
import { mapSeance } from '../src/schedule/mapping.js';
import { weekRanges } from '../src/schedule/weeks.js';
import { applySchema, createPool, replaceWeek } from '../src/db/seances.js';
import { log } from '../src/log.js';

let config;
try {
  config = loadSyncConfig();
} catch (error) {
  log(error.message);
  process.exit(1);
}

const loginOptions = {
  entUrl: config.entUrl,
  loggedInHosts: config.loggedInHosts,
  timeoutMs: config.loginTimeoutMs,
  credentials: config.credentials,
};

let browser;
let context;
let page;

async function openContext(state) {
  await context?.close();
  context = await browser.newContext(state ? { storageState: state } : {});
  page = await context.newPage();
}

/**
 * Login dans un contexte neuf : vider seulement les cookies d'un contexte expiré laisse son stockage
 * local, et l'ENT renvoie alors vers le login juste après la connexion.
 * Renvoie le `request` du nouveau contexte (pour le nouvel essai d'appel API).
 */
async function login() {
  log('Session absente ou expirée : login automatique.');
  await openContext(null);
  const host = await autoLogin(page, loginOptions);
  const { cookies } = await saveState(context, config.statePath);
  log(`Connecté (${host}). Session enregistrée : ${cookies} cookies.`);
  return context.request;
}

let pool;
let exitCode = 0;
try {
  pool = createPool(config.databaseUrl);
  await applySchema(pool);

  browser = await launchBrowser({ headless: config.headless });
  const state = await loadState(config.statePath);
  await openContext(state);

  const check = state
    ? await checkLoggedIn(page, {
        entUrl: config.entUrl,
        loggedInHosts: config.loggedInHosts,
        timeoutMs: config.navTimeoutMs,
      })
    : { loggedIn: false };
  if (!check.loggedIn) await login();

  const codePersonne =
    config.codePersonne ??
    (await discoverCodePersonne(page, { entUrl: config.entUrl, timeoutMs: config.navTimeoutMs }));

  const summary = [];
  for (const range of weekRanges(new Date(), config.scheduleWeeks)) {
    const raws = await fetchWeekWithRetry(
      context.request,
      {
        entUrl: config.entUrl,
        loggedInHosts: config.loggedInHosts,
        codePersonne,
        range,
      },
      login,
    );
    const seances = raws.map((raw) => mapSeance(raw, codePersonne));
    await replaceWeek(pool, codePersonne, range, seances);
    summary.push(`${range.start} → ${range.end} : ${seances.length} séance(s)`);
  }
  // Cookies éventuellement rafraîchis par l'ENT pendant la synchro : on garde la version la plus récente.
  await saveState(context, config.statePath);
  log(`Synchronisation terminée :\n  ${summary.join('\n  ')}`);
} catch (error) {
  exitCode = 1;
  log(
    `Échec de la synchronisation : ${error.name === 'TimeoutError' ? 'délai dépassé' : error.message}`,
  );
} finally {
  await browser?.close();
  await pool?.end();
}
process.exit(exitCode);

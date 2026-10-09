// Login manuel : ouvre l'ENT dans une fenêtre visible (noVNC dans Docker), attend la fin du SSO,
// puis enregistre le storageState. Aucun identifiant n'est lu ni stocké.
import { loadConfig } from '../src/config.js';
import { launchBrowser, saveState } from '../src/browser/session.js';
import { waitForLoggedIn } from '../src/browser/sso.js';
import { log } from '../src/log.js';

let config;
try {
  config = loadConfig();
} catch (error) {
  log(error.message);
  process.exit(1);
}

const browser = await launchBrowser({ headless: false });
let exitCode = 0;
try {
  // Contexte vierge : on repart d'une session propre plutôt que de prolonger une session expirée.
  const context = await browser.newContext();
  const page = await context.newPage();
  log(`Connecte-toi dans la fenêtre (${Math.round(config.loginTimeoutMs / 60_000)} min max).`);
  await page.goto(config.entUrl, { timeout: config.navTimeoutMs });

  const host = await waitForLoggedIn(page, {
    loggedInHosts: config.loggedInHosts,
    timeoutMs: config.loginTimeoutMs,
  });
  const { cookies, sessionCookies } = await saveState(context, config.statePath);
  log(
    `Connecté (${host}). Session enregistrée : ${cookies} cookies dont ${sessionCookies} de session.`,
  );
  if (cookies === 0) log('⚠️ Aucun cookie enregistré : la session ne sera pas réutilisable.');
} catch (error) {
  exitCode = 1;
  log(`Échec du login : ${error.name === 'TimeoutError' ? 'délai dépassé' : error.message}`);
} finally {
  await browser.close();
}
process.exit(exitCode);

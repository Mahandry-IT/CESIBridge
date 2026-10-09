// Délai max pour laisser finir les redirections JS / auto-post SAML après l'événement `load`.
const SETTLE_TIMEOUT_MS = 10_000;

// Pages de login servies par l'ENT lui-même (wayf, retour SAML) : même hôte, mais pas connecté.
const LOGIN_PATH_PREFIXES = ['/identification', '/login'];

/**
 * Indique si l'URL est sur un hôte « connecté », hors pages de login de l'ENT.
 * Une entrée `*.domaine.fr` accepte tous les sous-domaines (pas `domaine.fr` lui-même).
 */
export function isLoggedInHost(url, loggedInHosts) {
  let host;
  let path;
  try {
    ({ hostname: host, pathname: path } = new URL(url));
    host = host.toLowerCase();
  } catch {
    return false;
  }
  if (LOGIN_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return false;
  }
  return loggedInHosts.some((entry) =>
    entry.startsWith('*.') ? host.endsWith(entry.slice(1)) : host === entry,
  );
}

export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'inconnu';
  }
}

async function settle(page, timeoutMs) {
  try {
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, SETTLE_TIMEOUT_MS) });
  } catch {
    // Best effort : certaines pages ne sont jamais « idle » (polling). L'URL courante fait foi.
  }
}

/**
 * Charge l'ENT et vérifie l'hôte final : une redirection vers le SSO signifie session expirée.
 * Ne renvoie que l'hôte, jamais l'URL complète (elle peut porter des jetons).
 */
export async function checkLoggedIn(page, { entUrl, loggedInHosts, timeoutMs }) {
  await page.goto(entUrl, { waitUntil: 'load', timeout: timeoutMs });
  await settle(page, timeoutMs);
  const url = page.url();
  return { loggedIn: isLoggedInHost(url, loggedInHosts), host: hostOf(url) };
}

/**
 * Attend que l'utilisateur arrive (et reste) sur un hôte « connecté ».
 * La première URL est l'ENT lui-même, avant la redirection SSO : on revérifie après stabilisation.
 */
export async function waitForLoggedIn(page, { loggedInHosts, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForURL((url) => isLoggedInHost(url.href, loggedInHosts), {
      timeout: Math.max(deadline - Date.now(), 1),
      waitUntil: 'load',
    });
    await settle(page, deadline - Date.now());
    if (isLoggedInHost(page.url(), loggedInHosts)) return hostOf(page.url());
  }
  throw new Error(`Login non terminé après ${Math.round(timeoutMs / 1000)} s`);
}

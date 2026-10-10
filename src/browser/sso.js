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

export class LoginError extends Error {
  name = 'LoginError';
}

const POLL_INTERVAL_MS = 300;

// `input#login` : la page de connexion Moodle a un `form#login` qu'il ne faut pas remplir.
const SELECTORS = Object.freeze({
  email: 'input#login',
  user: '#userNameInput',
  password: '#passwordInput',
  submit: '#submitButton',
  error: '#errorText',
});

/**
 * Décide de la prochaine action du login à partir de l'état observé de la page.
 * Chaque formulaire n'est rempli qu'une fois : pas de seconde tentative, donc pas de verrouillage ADFS.
 * @returns {'done'|'refused'|'fill-email'|'fill-password'|'wait'}
 */
export function nextLoginAction({ loggedIn, errorVisible, emailVisible, passwordVisible, done }) {
  if (errorVisible) return 'refused';
  if (loggedIn) return 'done';
  if (passwordVisible && !done.password) return 'fill-password';
  if (emailVisible && !done.email) return 'fill-email';
  return 'wait';
}

// Pendant une navigation, le contexte d'exécution peut disparaître : on considère l'élément absent.
async function visible(page, selector) {
  try {
    return await page.locator(selector).first().isVisible();
  } catch {
    return false;
  }
}

async function observe(page, loggedInHosts) {
  const [errorVisible, emailVisible, passwordVisible] = await Promise.all([
    visible(page, SELECTORS.error),
    visible(page, SELECTORS.email),
    visible(page, SELECTORS.password),
  ]);
  return {
    loggedIn: isLoggedInHost(page.url(), loggedInHosts),
    errorVisible,
    emailVisible,
    passwordVisible,
  };
}

async function fillEmail(page, credentials) {
  const email = page.locator(SELECTORS.email).first();
  await email.fill(credentials.email);
  await email.press('Enter');
}

async function fillPassword(page, credentials) {
  // L'identifiant ADFS peut être pré-rempli : on le remplace quand même.
  if (await visible(page, SELECTORS.user))
    await page.locator(SELECTORS.user).fill(credentials.email);
  const password = page.locator(SELECTORS.password);
  await password.fill(credentials.password);
  if (await visible(page, SELECTORS.submit)) await page.locator(SELECTORS.submit).click();
  else await password.press('Enter');
}

/**
 * Login automatique (wayf → ADFS) depuis `startUrl` (ENT par défaut), en machine à états :
 * gère la reconnexion silencieuse (ADFS ne redemande pas le mot de passe).
 * Les erreurs ne contiennent ni URL, ni identifiant, ni mot de passe.
 */
export async function autoLogin(
  page,
  { entUrl, startUrl = entUrl, loggedInHosts, timeoutMs, credentials },
) {
  const deadline = Date.now() + timeoutMs;
  await page.goto(startUrl, { waitUntil: 'load', timeout: timeoutMs });
  await settle(page, timeoutMs);

  const done = { email: false, password: false };
  while (Date.now() < deadline) {
    const action = nextLoginAction({ ...(await observe(page, loggedInHosts)), done });
    try {
      if (action === 'refused') throw new LoginError('identifiants refusés');
      if (action === 'done') {
        // Hôte connecté atteint : on revérifie après stabilisation (redirections JS, auto-post SAML).
        await settle(page, deadline - Date.now());
        if (isLoggedInHost(page.url(), loggedInHosts)) return hostOf(page.url());
      } else if (action === 'fill-email') {
        done.email = true;
        await fillEmail(page, credentials);
      } else if (action === 'fill-password') {
        done.password = true;
        await fillPassword(page, credentials);
      } else {
        await page.waitForTimeout(POLL_INTERVAL_MS);
      }
    } catch (error) {
      if (error instanceof LoginError) throw error;
      // Message Playwright jamais relayé : il peut contenir des URL à jetons.
      throw new LoginError(`formulaire de login inattendu (hôte ${hostOf(page.url())})`);
    }
  }
  const reason =
    done.email || done.password ? 'Login non terminé' : 'formulaire de login introuvable';
  throw new LoginError(
    `${reason} après ${Math.round(timeoutMs / 1000)} s (hôte ${hostOf(page.url())})`,
  );
}

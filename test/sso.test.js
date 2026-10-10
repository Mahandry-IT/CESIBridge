import { describe, expect, it } from 'vitest';
import {
  autoLogin,
  checkLoggedIn,
  isLoggedInHost,
  LoginError,
  nextLoginAction,
} from '../src/browser/sso.js';

const hosts = ['ent.example.fr', '*.moodle.example.fr'];

describe('isLoggedInHost', () => {
  it.each([
    ['https://ent.example.fr/accueil', true],
    ['https://ENT.example.fr/', true],
    ['https://cours.moodle.example.fr/my', true],
    ['https://moodle.example.fr/', false],
    ['https://sso.example.fr/login?service=x', false],
    ['https://ent.example.fr.evil.com/', false],
    ['https://evil-ent.example.fr/', false],
    ['https://ent.example.fr/identification/wayf', false],
    ['https://ent.example.fr/identification/wayf/', false],
    ['https://ent.example.fr/login/ClientIdpViaCesiFr', false],
    ['https://ent.example.fr/loginfo', true],
    ['pas une url', false],
  ])('%s -> %s', (url, expected) => {
    expect(isLoggedInHost(url, hosts)).toBe(expected);
  });
});

function fakePage(finalUrl) {
  return {
    goto: async () => {},
    waitForLoadState: async () => {
      throw new Error('jamais idle');
    },
    url: () => finalUrl,
  };
}

describe('checkLoggedIn', () => {
  const options = { entUrl: 'https://ent.example.fr/', loggedInHosts: hosts, timeoutMs: 1000 };

  it('connecté si l’hôte final est autorisé, même sans networkidle', async () => {
    const result = await checkLoggedIn(fakePage('https://ent.example.fr/home'), options);

    expect(result).toEqual({ loggedIn: true, host: 'ent.example.fr' });
  });

  it('expiré si redirigé vers le SSO, sans exposer l’URL complète', async () => {
    const page = fakePage('https://sso.example.fr/login?ticket=SECRET');

    const result = await checkLoggedIn(page, options);

    expect(result).toEqual({ loggedIn: false, host: 'sso.example.fr' });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});

describe('nextLoginAction', () => {
  const none = { email: false, password: false };
  const base = {
    loggedIn: false,
    errorVisible: false,
    emailVisible: false,
    passwordVisible: false,
  };

  it.each([
    ['connecté', { ...base, loggedIn: true }, none, 'done'],
    [
      'erreur ADFS prioritaire',
      { ...base, errorVisible: true, passwordVisible: true },
      none,
      'refused',
    ],
    ['e-mail demandé', { ...base, emailVisible: true }, none, 'fill-email'],
    ['e-mail déjà saisi', { ...base, emailVisible: true }, { ...none, email: true }, 'wait'],
    [
      'mot de passe demandé',
      { ...base, passwordVisible: true },
      { ...none, email: true },
      'fill-password',
    ],
    [
      'mot de passe déjà saisi',
      { ...base, passwordVisible: true },
      { email: true, password: true },
      'wait',
    ],
    ['rien de visible', base, none, 'wait'],
  ])('%s', (_label, observed, done, expected) => {
    expect(nextLoginAction({ ...observed, done })).toBe(expected);
  });
});

/**
 * Faux `page` : une suite d'écrans ; une saisie validée (Entrée, clic) passe à l'écran suivant.
 * Un écran = { url, visible: [sélecteurs] }.
 */
function scriptedPage(screens) {
  let index = 0;
  const fills = [];
  const advance = () => {
    index = Math.min(index + 1, screens.length - 1);
  };
  const locator = (selector) => {
    const self = {
      first: () => self,
      isVisible: async () => screens[index].visible?.includes(selector) ?? false,
      fill: async (value) => fills.push([selector, value]),
      press: async () => advance(),
      click: async () => advance(),
    };
    return self;
  };
  return {
    fills,
    goto: async () => {},
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    url: () => screens[index].url,
    locator,
  };
}

describe('autoLogin', () => {
  const credentials = { email: 'etu@example.fr' };
  Object.defineProperty(credentials, 'password', { value: 'motdepasse' });
  const options = {
    entUrl: 'https://ent.example.fr/',
    loggedInHosts: ['ent.example.fr'],
    timeoutMs: 1000,
    credentials,
  };
  const wayf = { url: 'https://wayf.example.fr/login', visible: ['input#login'] };
  const adfs = {
    url: 'https://sts.example.fr/adfs/ls/',
    visible: ['#userNameInput', '#passwordInput', '#submitButton'],
  };
  const home = { url: 'https://ent.example.fr/home' };

  it('reconnexion silencieuse : e-mail seulement, pas de mot de passe', async () => {
    const page = scriptedPage([wayf, home]);

    await expect(autoLogin(page, options)).resolves.toBe('ent.example.fr');
    expect(page.fills).toEqual([['input#login', 'etu@example.fr']]);
  });

  it('remplit e-mail puis identifiant et mot de passe', async () => {
    const page = scriptedPage([wayf, adfs, home]);

    await expect(autoLogin(page, options)).resolves.toBe('ent.example.fr');
    expect(page.fills.map(([selector]) => selector)).toEqual([
      'input#login',
      '#userNameInput',
      '#passwordInput',
    ]);
  });

  it('déjà connecté : ne saisit rien', async () => {
    const page = scriptedPage([home]);

    await expect(autoLogin(page, options)).resolves.toBe('ent.example.fr');
    expect(page.fills).toEqual([]);
  });

  it('identifiants refusés : LoginError sans secret', async () => {
    const refused = { ...adfs, visible: [...adfs.visible, '#errorText'] };
    const page = scriptedPage([wayf, adfs, refused]);

    const error = await autoLogin(page, options).catch((e) => e);

    expect(error).toBeInstanceOf(LoginError);
    expect(error.message).toBe('identifiants refusés');
  });

  it('ne remplit chaque formulaire qu’une fois si la page revient', async () => {
    // Après le mot de passe, ADFS réaffiche le formulaire sans message d'erreur.
    const page = scriptedPage([wayf, adfs, adfs]);

    const error = await autoLogin(page, { ...options, timeoutMs: 50 }).catch((e) => e);

    expect(error).toBeInstanceOf(LoginError);
    expect(page.fills.filter(([selector]) => selector === '#passwordInput')).toHaveLength(1);
    expect(error.message).not.toContain('motdepasse');
  });

  it('ignore le formulaire de connexion propre à Moodle (form#login)', async () => {
    const page = scriptedPage([
      { url: 'https://moodle.example.fr/login/index.php', visible: ['#login'] },
    ]);

    const error = await autoLogin(page, { ...options, timeoutMs: 30 }).catch((e) => e);

    expect(error.message).toMatch(/formulaire de login introuvable/);
    expect(page.fills).toEqual([]);
  });
});

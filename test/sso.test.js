import { describe, expect, it } from 'vitest';
import { checkLoggedIn, isLoggedInHost } from '../src/browser/sso.js';

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

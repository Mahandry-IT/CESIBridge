import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const validEnv = {
  CESI_ENT_URL: 'https://ent.example.fr/',
  CESI_LOGGED_IN_HOSTS: ' ENT.example.fr , *.moodle.example.fr ,',
};

describe('loadConfig', () => {
  it('parse une configuration valide et applique les valeurs par défaut', () => {
    const config = loadConfig(validEnv);

    expect(config).toEqual({
      entUrl: 'https://ent.example.fr/',
      loggedInHosts: ['ent.example.fr', '*.moodle.example.fr'],
      statePath: './data/state.json',
      navTimeoutMs: 30_000,
      loginTimeoutMs: 300_000,
    });
  });

  it('convertit les timeouts numériques', () => {
    const config = loadConfig({ ...validEnv, CESI_NAV_TIMEOUT_MS: '5000' });

    expect(config.navTimeoutMs).toBe(5000);
  });

  it('liste toutes les variables manquantes', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/CESI_ENT_URL[\s\S]*CESI_LOGGED_IN_HOSTS/);
  });

  it.each([
    ['URL non http', { CESI_ENT_URL: 'ftp://ent.example.fr' }],
    ['liste d’hôtes vide', { CESI_LOGGED_IN_HOSTS: ' , ' }],
    ['timeout négatif', { CESI_NAV_TIMEOUT_MS: '-1' }],
  ])('rejette : %s', (_label, override) => {
    expect(() => loadConfig({ ...validEnv, ...override })).toThrow(ConfigError);
  });
});

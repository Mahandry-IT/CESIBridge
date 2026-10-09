import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, loadPublishConfig, loadSyncConfig } from '../src/config.js';

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

describe('loadSyncConfig', () => {
  const syncEnv = {
    ...validEnv,
    CESI_EMAIL: 'a.b@viacesi.fr',
    CESI_PASSWORD: 's3cret',
    CESI_CODE_PERSONNE: '12345',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  };

  it('applique les défauts (4 semaines, navigateur visible)', () => {
    const config = loadSyncConfig(syncEnv);

    expect(config).toMatchObject({
      codePersonne: '12345',
      scheduleWeeks: 4,
      headless: false,
      databaseUrl: 'postgres://u:p@localhost:5432/db',
    });
    expect(config.credentials.email).toBe('a.b@viacesi.fr');
    expect(config.credentials.password).toBe('s3cret');
  });

  it('accepte un code personne absent ou vide (découverte automatique)', () => {
    expect(
      loadSyncConfig({ ...syncEnv, CESI_CODE_PERSONNE: undefined }).codePersonne,
    ).toBeUndefined();
    expect(loadSyncConfig({ ...syncEnv, CESI_CODE_PERSONNE: '' }).codePersonne).toBeUndefined();
  });

  it('ne laisse pas fuiter le mot de passe en sérialisation', () => {
    expect(JSON.stringify(loadSyncConfig(syncEnv))).not.toContain('s3cret');
  });

  it('liste les variables manquantes', () => {
    let error;
    try {
      loadSyncConfig({ ...validEnv, CESI_PASSWORD: '' });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(ConfigError);
    expect(error.message).toMatch(/CESI_EMAIL[\s\S]*CESI_PASSWORD[\s\S]*DATABASE_URL/);
  });

  it.each([
    ['0 semaine', { CESI_SCHEDULE_WEEKS: '0' }],
    ['9 semaines', { CESI_SCHEDULE_WEEKS: '9' }],
    ['semaines non entières', { CESI_SCHEDULE_WEEKS: '2.5' }],
    ['code personne non numérique', { CESI_CODE_PERSONNE: 'abc' }],
    ['CESI_HEADLESS inconnu', { CESI_HEADLESS: 'peut-être' }],
    ['e-mail invalide', { CESI_EMAIL: 'pas-un-mail' }],
  ])('rejette : %s', (_label, override) => {
    expect(() => loadSyncConfig({ ...syncEnv, ...override })).toThrow(ConfigError);
  });

  it.each([
    ['false', false],
    ['true', true],
    ['TRUE', true],
  ])('parse CESI_HEADLESS=%s', (value, expected) => {
    expect(loadSyncConfig({ ...syncEnv, CESI_HEADLESS: value }).headless).toBe(expected);
  });

  it('accepte les bornes 1 et 8', () => {
    expect(loadSyncConfig({ ...syncEnv, CESI_SCHEDULE_WEEKS: '1' }).scheduleWeeks).toBe(1);
    expect(loadSyncConfig({ ...syncEnv, CESI_SCHEDULE_WEEKS: '8' }).scheduleWeeks).toBe(8);
  });
});

describe('configuration Google', () => {
  const env = {
    ...validEnv,
    CESI_EMAIL: 'a.b@viacesi.fr',
    CESI_PASSWORD: 's3cret',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  };
  const google = {
    GOOGLE_CALENDAR_ID: 'cal@group.calendar.google.com',
    GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/k.json',
  };

  it('est absente par défaut, chaînes vides comprises', () => {
    expect(loadSyncConfig(env).google).toBeNull();
    expect(
      loadSyncConfig({ ...env, GOOGLE_CALENDAR_ID: '', GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '' })
        .google,
    ).toBeNull();
  });

  it('est lue quand les deux variables sont définies', () => {
    expect(loadSyncConfig({ ...env, ...google }).google).toEqual({
      calendarId: 'cal@group.calendar.google.com',
      keyFile: '/k.json',
    });
  });

  it.each([
    ['agenda seul', { GOOGLE_CALENDAR_ID: 'x' }],
    ['clé seule', { GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/k.json' }],
  ])('rejette : %s', (_label, override) => {
    expect(() => loadSyncConfig({ ...env, ...override })).toThrow(ConfigError);
  });

  it('publish exige Google mais pas les identifiants CESI', () => {
    const publishEnv = { DATABASE_URL: env.DATABASE_URL, ...google };
    expect(loadPublishConfig(publishEnv)).toMatchObject({ scheduleWeeks: 4 });
    expect(() => loadPublishConfig({ DATABASE_URL: env.DATABASE_URL })).toThrow(ConfigError);
  });
});

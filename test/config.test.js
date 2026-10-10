import util from 'node:util';
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
      credentials: null,
      moodleUrl: null,
      downloadDir: './data/downloads',
      downloadMaxBytes: 50 * 1024 * 1024,
    });
  });

  it('lit les identifiants facultatifs, mot de passe non sérialisé', () => {
    const config = loadConfig({
      ...validEnv,
      CESI_EMAIL: 'a.b@viacesi.fr',
      CESI_PASSWORD: 's3cret',
    });

    expect(config.credentials.email).toBe('a.b@viacesi.fr');
    expect(config.credentials.password).toBe('s3cret');
    expect(JSON.stringify(config)).not.toContain('s3cret');
  });

  it('identifiants vides = absents', () => {
    expect(loadConfig({ ...validEnv, CESI_EMAIL: '', CESI_PASSWORD: '' }).credentials).toBeNull();
  });

  it('lit Moodle et les téléchargements', () => {
    const config = loadConfig({
      ...validEnv,
      CESI_MOODLE_URL: 'https://moodle.cesi.fr/login/index.php?authCAS=CAS',
      CESI_DOWNLOAD_DIR: '/tmp/dl',
      CESI_DOWNLOAD_MAX_MB: '10',
    });

    expect(config).toMatchObject({
      moodleUrl: 'https://moodle.cesi.fr/login/index.php?authCAS=CAS',
      downloadDir: '/tmp/dl',
      downloadMaxBytes: 10 * 1024 * 1024,
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
    ['e-mail sans mot de passe', { CESI_EMAIL: 'a.b@viacesi.fr' }],
    ['mot de passe sans e-mail', { CESI_PASSWORD: 's3cret' }],
    ['Moodle hors domaine', { CESI_MOODLE_URL: 'https://moodle.example.com/' }],
    ['Moodle en http', { CESI_MOODLE_URL: 'http://moodle.cesi.fr/' }],
    ['taille de téléchargement nulle', { CESI_DOWNLOAD_MAX_MB: '0' }],
    ['taille de téléchargement trop grande', { CESI_DOWNLOAD_MAX_MB: '501' }],
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

describe('configuration des examens', () => {
  const env = {
    ...validEnv,
    CESI_EMAIL: 'a.b@viacesi.fr',
    CESI_PASSWORD: 's3cret',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  };
  const exams = { CESI_FILIERE: 'FISE Informatique', CESI_NIVEAU: 'a3' };
  const google = {
    GOOGLE_CALENDAR_ID: 'cal@group.calendar.google.com',
    GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/k.json',
  };
  const now = new Date('2026-10-10T10:00:00Z');

  it('est désactivée par défaut, chaînes vides comprises', () => {
    expect(loadSyncConfig(env).exams).toBeNull();
    expect(loadSyncConfig({ ...env, CESI_FILIERE: '', CESI_NIVEAU: '' }).exams).toBeNull();
  });

  it('est activée avec les défauts, niveau normalisé en majuscules', () => {
    expect(loadSyncConfig({ ...env, ...exams }, now).exams).toEqual({
      filiere: 'FISE Informatique',
      niveau: 'A3',
      annee: '2026-2027',
      reminderDays: [1],
      correctionsFile: './data/exam-corrections.json',
    });
  });

  it('est aussi lue par publish ; sync expose moodleUrl et la taille max', () => {
    const publishEnv = { DATABASE_URL: env.DATABASE_URL, ...google, ...exams };
    expect(loadPublishConfig(publishEnv, now).exams).toMatchObject({ niveau: 'A3' });
    expect(loadSyncConfig(env)).toMatchObject({
      moodleUrl: null,
      downloadMaxBytes: 50 * 1024 * 1024,
    });
  });

  it.each([
    ['filière seule', { CESI_FILIERE: 'FISE Informatique' }],
    ['niveau seul', { CESI_NIVEAU: 'A3' }],
  ])('rejette : %s', (_label, override) => {
    expect(() => loadSyncConfig({ ...env, ...override })).toThrow(/doivent être définies ensemble/);
  });

  it.each([
    ['2026-07-31T21:59:59Z', '2025-2026'],
    ['2026-07-31T22:00:00Z', '2026-2027'],
    ['2026-12-31T23:30:00Z', '2026-2027'],
    ['2027-01-15T12:00:00Z', '2026-2027'],
  ])('année par défaut à %s (heure de Paris) : %s', (date, expected) => {
    expect(loadSyncConfig({ ...env, ...exams }, new Date(date)).exams.annee).toBe(expected);
  });

  it('accepte une année explicite', () => {
    expect(loadSyncConfig({ ...env, ...exams, CESI_ANNEE: '2024-2025' }).exams.annee).toBe(
      '2024-2025',
    );
  });

  it.each([
    ['1', [1]],
    ['3,1,2', [1, 2, 3]],
    [' 2 , 2 , 7 ', [2, 7]],
    ['1,2,3,3,4', [1, 2, 3, 4]],
    ['27', [27]],
    ['', [1]],
  ])('rappels %j : %j', (value, expected) => {
    const config = loadSyncConfig({ ...env, ...exams, CESI_EXAM_REMINDER_DAYS: value });
    expect(config.exams.reminderDays).toEqual(expected);
  });

  it.each([
    ['année non consécutive', { CESI_ANNEE: '2026-2028' }],
    ['année mal formée', { CESI_ANNEE: '2026' }],
    ['niveau inconnu', { CESI_NIVEAU: 'A6' }],
    ['rappel à 0', { CESI_EXAM_REMINDER_DAYS: '0' }],
    ['rappel à 28', { CESI_EXAM_REMINDER_DAYS: '28' }],
    ['rappel non entier', { CESI_EXAM_REMINDER_DAYS: '1,x' }],
    ['rappel vide dans la liste', { CESI_EXAM_REMINDER_DAYS: '1,,2' }],
    ['5 rappels distincts', { CESI_EXAM_REMINDER_DAYS: '1,2,3,4,5' }],
  ])('rejette : %s', (_label, override) => {
    expect(() => loadSyncConfig({ ...env, ...exams, ...override })).toThrow(ConfigError);
  });
});

describe('configuration du mail', () => {
  const env = {
    ...validEnv,
    CESI_EMAIL: 'a.b@viacesi.fr',
    CESI_PASSWORD: 's3cret',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  };
  const mail = { CESI_MAIL_USER: 'moi@gmail.com', CESI_MAIL_PASSWORD: 'app-pass-word' };

  it('est désactivée par défaut, chaînes vides comprises', () => {
    expect(loadSyncConfig(env).mail).toBeNull();
    expect(loadSyncConfig({ ...env, CESI_MAIL_USER: '', CESI_MAIL_PASSWORD: '' }).mail).toBeNull();
  });

  it('applique les défauts : destinataire = expéditeur, Gmail en TLS implicite', () => {
    expect(loadSyncConfig({ ...env, ...mail }).mail).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      user: 'moi@gmail.com',
      to: 'moi@gmail.com',
    });
  });

  it('lit le destinataire, l’hôte et le port', () => {
    const config = loadSyncConfig({
      ...env,
      ...mail,
      CESI_MAIL_TO: 'autre@example.fr',
      CESI_MAIL_SMTP_HOST: 'smtp.example.fr',
      CESI_MAIL_SMTP_PORT: '587',
    });
    expect(config.mail).toMatchObject({
      to: 'autre@example.fr',
      host: 'smtp.example.fr',
      port: 587,
    });
  });

  it('expose le mot de passe sans jamais le sérialiser', () => {
    const { mail: config } = loadSyncConfig({ ...env, ...mail });
    expect(config.password).toBe('app-pass-word');
    expect(JSON.stringify(config)).not.toContain('app-pass-word');
    expect(JSON.stringify({ ...config })).not.toContain('app-pass-word');
    expect(Object.keys(config)).not.toContain('password');
    expect(util.inspect(config)).not.toContain('app-pass-word');
  });

  it('n’est pas lue par publish', () => {
    const publishEnv = {
      DATABASE_URL: env.DATABASE_URL,
      GOOGLE_CALENDAR_ID: 'c',
      GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/k',
    };
    expect(loadPublishConfig({ ...publishEnv, ...mail })).not.toHaveProperty('mail');
  });

  it.each([
    ['adresse seule', { CESI_MAIL_USER: 'moi@gmail.com' }],
    ['mot de passe seul', { CESI_MAIL_PASSWORD: 'app-pass-word' }],
  ])('rejette : %s', (_label, override) => {
    expect(() => loadSyncConfig({ ...env, ...override })).toThrow(/doivent être définies ensemble/);
  });

  it.each([
    ['adresse invalide', { CESI_MAIL_USER: 'pas-une-adresse' }],
    ['destinataire invalide', { CESI_MAIL_TO: 'pas-une-adresse' }],
    ['port à 0', { CESI_MAIL_SMTP_PORT: '0' }],
    ['port trop grand', { CESI_MAIL_SMTP_PORT: '65536' }],
    ['port non entier', { CESI_MAIL_SMTP_PORT: '46.5' }],
    ['port non numérique', { CESI_MAIL_SMTP_PORT: 'smtp' }],
  ])('rejette : %s sans citer la valeur', (_label, override) => {
    const attempt = () => loadSyncConfig({ ...env, ...mail, ...override });
    expect(attempt).toThrow(ConfigError);
    const [value] = Object.values(override);
    expect(() => attempt()).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(value) }),
    );
  });
});

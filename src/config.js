import { z } from 'zod';

const DEFAULT_STATE_PATH = './data/state.json';
const DEFAULT_NAV_TIMEOUT_MS = 30_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_SCHEDULE_WEEKS = 4;
const DEFAULT_DOWNLOAD_DIR = './data/downloads';
const DEFAULT_DOWNLOAD_MAX_MB = 50;
const MAX_DOWNLOAD_MAX_MB = 500;
const BYTES_PER_MB = 1024 * 1024;
const MOODLE_HOST = 'moodle.cesi.fr';

const hostList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.string()).min(1, 'au moins un hôte attendu'));

const timeout = (fallback) => z.coerce.number().int().positive().default(fallback);

const boolFlag = (fallback) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(['true', 'false']))
    .transform((value) => value === 'true')
    .default(fallback);

// Chaîne vide = variable absente.
const emptyToUndefined = (value) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const codePersonneField = z.preprocess(
  emptyToUndefined,
  z.string().regex(/^\d+$/, 'chaîne de chiffres attendue').optional(),
);

const weeksField = z.coerce.number().int().min(1).max(8).default(DEFAULT_SCHEDULE_WEEKS);

const databaseUrlField = z.string().regex(/^postgres(ql)?:\/\/.+/, 'URL postgres:// attendue');

const googleShape = {
  GOOGLE_CALENDAR_ID: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).optional(),
  ),
};

// Lien d'accès Moodle (passe par le SSO) : https sur l'hôte Moodle uniquement.
const moodleUrlField = z.preprocess(
  emptyToUndefined,
  z
    .url({ protocol: /^https$/ })
    .refine(
      (value) => new URL(value).hostname === MOODLE_HOST,
      `URL https://${MOODLE_HOST}/… attendue`,
    )
    .optional(),
);

const baseShape = {
  CESI_ENT_URL: z.url({ protocol: /^https?$/ }),
  CESI_LOGGED_IN_HOSTS: hostList,
  CESI_STATE_PATH: z.string().min(1).default(DEFAULT_STATE_PATH),
  CESI_NAV_TIMEOUT_MS: timeout(DEFAULT_NAV_TIMEOUT_MS),
  CESI_LOGIN_TIMEOUT_MS: timeout(DEFAULT_LOGIN_TIMEOUT_MS),
};

// Serveur MCP : identifiants facultatifs (reconnexion automatique), mais ensemble.
const schema = z.object({
  ...baseShape,
  CESI_EMAIL: z.preprocess(emptyToUndefined, z.email().optional()),
  CESI_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  CESI_MOODLE_URL: moodleUrlField,
  CESI_DOWNLOAD_DIR: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default(DEFAULT_DOWNLOAD_DIR),
  ),
  CESI_DOWNLOAD_MAX_MB: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_DOWNLOAD_MAX_MB)
    .default(DEFAULT_DOWNLOAD_MAX_MB),
});

// Variables requises uniquement par la synchronisation (login auto + base), pas par le serveur MCP.
const syncSchema = z.object({
  ...baseShape,
  CESI_EMAIL: z.email(),
  CESI_PASSWORD: z.string().min(1),
  // Facultatif : sinon découvert sur la page emploi du temps après le login.
  CESI_CODE_PERSONNE: codePersonneField,
  CESI_SCHEDULE_WEEKS: weeksField,
  CESI_HEADLESS: boolFlag(false),
  DATABASE_URL: databaseUrlField,
  ...googleShape,
});

// `npm run publish` : republie depuis la base, sans ENT ni navigateur. Google est ici obligatoire.
const publishSchema = z.object({
  CESI_CODE_PERSONNE: codePersonneField,
  CESI_SCHEDULE_WEEKS: weeksField,
  DATABASE_URL: databaseUrlField,
  GOOGLE_CALENDAR_ID: z.string().trim().min(1),
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: z.string().trim().min(1),
});

export class ConfigError extends Error {
  name = 'ConfigError';
}

// Les messages ne citent que le nom des variables et la règle violée, jamais leur valeur.
function parseEnv(zodSchema, env) {
  const result = zodSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')} : ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Configuration invalide :\n${details}`);
  }
  return result.data;
}

function baseConfig(parsed) {
  return {
    entUrl: parsed.CESI_ENT_URL,
    loggedInHosts: Object.freeze(parsed.CESI_LOGGED_IN_HOSTS),
    statePath: parsed.CESI_STATE_PATH,
    navTimeoutMs: parsed.CESI_NAV_TIMEOUT_MS,
    loginTimeoutMs: parsed.CESI_LOGIN_TIMEOUT_MS,
  };
}

// Google est facultatif pour la synchro, mais les deux variables vont ensemble.
function googleConfig(parsed) {
  const calendarId = parsed.GOOGLE_CALENDAR_ID;
  const keyFile = parsed.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (calendarId === undefined && keyFile === undefined) return null;
  if (calendarId === undefined || keyFile === undefined) {
    throw new ConfigError(
      'Configuration invalide :\n  - GOOGLE_CALENDAR_ID et GOOGLE_SERVICE_ACCOUNT_KEY_FILE doivent être définies ensemble',
    );
  }
  return Object.freeze({ calendarId, keyFile });
}

// Le mot de passe est non énumérable : absent de JSON.stringify, console.log et spread.
function makeCredentials(email, password) {
  const credentials = { email };
  Object.defineProperty(credentials, 'password', { value: password });
  return Object.freeze(credentials);
}

function optionalCredentials(parsed) {
  const { CESI_EMAIL: email, CESI_PASSWORD: password } = parsed;
  if (email === undefined && password === undefined) return null;
  if (email === undefined || password === undefined) {
    throw new ConfigError(
      'Configuration invalide :\n  - CESI_EMAIL et CESI_PASSWORD doivent être définies ensemble',
    );
  }
  return makeCredentials(email, password);
}

export function loadConfig(env = process.env) {
  const parsed = parseEnv(schema, env);
  return Object.freeze({
    ...baseConfig(parsed),
    credentials: optionalCredentials(parsed),
    moodleUrl: parsed.CESI_MOODLE_URL ?? null,
    downloadDir: parsed.CESI_DOWNLOAD_DIR,
    downloadMaxBytes: parsed.CESI_DOWNLOAD_MAX_MB * BYTES_PER_MB,
  });
}

export function loadSyncConfig(env = process.env) {
  const parsed = parseEnv(syncSchema, env);
  return Object.freeze({
    ...baseConfig(parsed),
    credentials: makeCredentials(parsed.CESI_EMAIL, parsed.CESI_PASSWORD),
    codePersonne: parsed.CESI_CODE_PERSONNE,
    scheduleWeeks: parsed.CESI_SCHEDULE_WEEKS,
    headless: parsed.CESI_HEADLESS,
    databaseUrl: parsed.DATABASE_URL,
    google: googleConfig(parsed),
  });
}

export function loadPublishConfig(env = process.env) {
  const parsed = parseEnv(publishSchema, env);
  return Object.freeze({
    codePersonne: parsed.CESI_CODE_PERSONNE,
    scheduleWeeks: parsed.CESI_SCHEDULE_WEEKS,
    databaseUrl: parsed.DATABASE_URL,
    google: googleConfig(parsed),
  });
}

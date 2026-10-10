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
const DEFAULT_EXAM_CORRECTIONS_FILE = './data/exam-corrections.json';
const DEFAULT_EXAM_REMINDER_DAYS = Object.freeze([1]);
const MAX_EXAM_REMINDER_DAYS = 27;
const MAX_EXAM_REMINDERS = 4;
const DEFAULT_MAIL_SMTP_HOST = 'smtp.gmail.com';
const DEFAULT_MAIL_SMTP_PORT = 465;
const MAX_PORT = 65_535;
// Les années scolaires commencent le 1er août.
const SCHOOL_YEAR_START_MONTH = 8;

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

const downloadMaxMbField = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_DOWNLOAD_MAX_MB)
  .default(DEFAULT_DOWNLOAD_MAX_MB);

const optionalText = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());

// Calendrier des examens : filière et niveau vont ensemble, le reste a des défauts.
const examsShape = {
  CESI_FILIERE: optionalText,
  CESI_NIVEAU: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^A[1-5]$/i, 'niveau A1 à A5 attendu')
      .transform((value) => value.toUpperCase())
      .optional(),
  ),
  CESI_ANNEE: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{4}$/, 'format AAAA-AAAA attendu')
      .refine((value) => {
        const [start, end] = value.split('-').map(Number);
        return end === start + 1;
      }, 'la seconde année doit suivre la première')
      .optional(),
  ),
  CESI_EXAM_REMINDER_DAYS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .transform((value) => value.split(',').map((day) => day.trim()))
      .pipe(z.array(z.coerce.number().int().min(1).max(MAX_EXAM_REMINDER_DAYS)).min(1))
      .transform((days) => [...new Set(days)].sort((a, b) => a - b))
      .pipe(z.array(z.number()).max(MAX_EXAM_REMINDERS, `${MAX_EXAM_REMINDERS} rappels maximum`))
      .optional(),
  ),
  CESI_EXAM_CORRECTIONS_FILE: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default(DEFAULT_EXAM_CORRECTIONS_FILE),
  ),
};

// Rappels par e-mail : l'adresse et le mot de passe d'application vont ensemble.
const mailShape = {
  CESI_MAIL_USER: z.preprocess(emptyToUndefined, z.email().optional()),
  CESI_MAIL_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  CESI_MAIL_TO: z.preprocess(emptyToUndefined, z.email().optional()),
  CESI_MAIL_SMTP_HOST: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).default(DEFAULT_MAIL_SMTP_HOST),
  ),
  CESI_MAIL_SMTP_PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(MAX_PORT).default(DEFAULT_MAIL_SMTP_PORT),
  ),
};

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
  CESI_DOWNLOAD_MAX_MB: downloadMaxMbField,
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
  CESI_MOODLE_URL: moodleUrlField,
  CESI_DOWNLOAD_MAX_MB: downloadMaxMbField,
  ...googleShape,
  ...examsShape,
  ...mailShape,
});

// `npm run publish` : republie depuis la base, sans ENT ni navigateur. Google est ici obligatoire.
const publishSchema = z.object({
  CESI_CODE_PERSONNE: codePersonneField,
  CESI_SCHEDULE_WEEKS: weeksField,
  DATABASE_URL: databaseUrlField,
  GOOGLE_CALENDAR_ID: z.string().trim().min(1),
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: z.string().trim().min(1),
  ...examsShape,
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

// Année scolaire en cours, d'après la date de Paris (et non celle du fuseau du processus).
function currentSchoolYear(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year').value);
  const month = Number(parts.find((part) => part.type === 'month').value);
  const start = month >= SCHOOL_YEAR_START_MONTH ? year : year - 1;
  return `${start}-${start + 1}`;
}

// Examens facultatifs, mais filière et niveau vont ensemble.
function examsConfig(parsed, now) {
  const filiere = parsed.CESI_FILIERE;
  const niveau = parsed.CESI_NIVEAU;
  if (filiere === undefined && niveau === undefined) return null;
  if (filiere === undefined || niveau === undefined) {
    throw new ConfigError(
      'Configuration invalide :\n  - CESI_FILIERE et CESI_NIVEAU doivent être définies ensemble',
    );
  }
  return Object.freeze({
    filiere,
    niveau,
    annee: parsed.CESI_ANNEE ?? currentSchoolYear(now),
    reminderDays: Object.freeze(parsed.CESI_EXAM_REMINDER_DAYS ?? DEFAULT_EXAM_REMINDER_DAYS),
    correctionsFile: parsed.CESI_EXAM_CORRECTIONS_FILE,
  });
}

// Le mot de passe est non énumérable : absent de JSON.stringify, console.log et spread.
function makeCredentials(email, password) {
  const credentials = { email };
  Object.defineProperty(credentials, 'password', { value: password });
  return Object.freeze(credentials);
}

// Mail facultatif : le mot de passe d'application est non énumérable, comme celui des identifiants.
function mailConfig(parsed) {
  const { CESI_MAIL_USER: user, CESI_MAIL_PASSWORD: password } = parsed;
  if (user === undefined && password === undefined) return null;
  if (user === undefined || password === undefined) {
    throw new ConfigError(
      'Configuration invalide :\n  - CESI_MAIL_USER et CESI_MAIL_PASSWORD doivent être définies ensemble',
    );
  }
  const mail = {
    host: parsed.CESI_MAIL_SMTP_HOST,
    port: parsed.CESI_MAIL_SMTP_PORT,
    user,
    to: parsed.CESI_MAIL_TO ?? user,
  };
  Object.defineProperty(mail, 'password', { value: password });
  return Object.freeze(mail);
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

export function loadSyncConfig(env = process.env, now = new Date()) {
  const parsed = parseEnv(syncSchema, env);
  return Object.freeze({
    ...baseConfig(parsed),
    credentials: makeCredentials(parsed.CESI_EMAIL, parsed.CESI_PASSWORD),
    codePersonne: parsed.CESI_CODE_PERSONNE,
    scheduleWeeks: parsed.CESI_SCHEDULE_WEEKS,
    headless: parsed.CESI_HEADLESS,
    databaseUrl: parsed.DATABASE_URL,
    google: googleConfig(parsed),
    moodleUrl: parsed.CESI_MOODLE_URL ?? null,
    downloadMaxBytes: parsed.CESI_DOWNLOAD_MAX_MB * BYTES_PER_MB,
    exams: examsConfig(parsed, now),
    mail: mailConfig(parsed),
  });
}

export function loadPublishConfig(env = process.env, now = new Date()) {
  const parsed = parseEnv(publishSchema, env);
  return Object.freeze({
    codePersonne: parsed.CESI_CODE_PERSONNE,
    scheduleWeeks: parsed.CESI_SCHEDULE_WEEKS,
    databaseUrl: parsed.DATABASE_URL,
    google: googleConfig(parsed),
    exams: examsConfig(parsed, now),
  });
}

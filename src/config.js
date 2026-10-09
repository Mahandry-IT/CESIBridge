import { z } from 'zod';

const DEFAULT_STATE_PATH = './data/state.json';
const DEFAULT_NAV_TIMEOUT_MS = 30_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_SCHEDULE_WEEKS = 4;

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

const baseShape = {
  CESI_ENT_URL: z.url({ protocol: /^https?$/ }),
  CESI_LOGGED_IN_HOSTS: hostList,
  CESI_STATE_PATH: z.string().min(1).default(DEFAULT_STATE_PATH),
  CESI_NAV_TIMEOUT_MS: timeout(DEFAULT_NAV_TIMEOUT_MS),
  CESI_LOGIN_TIMEOUT_MS: timeout(DEFAULT_LOGIN_TIMEOUT_MS),
};

const schema = z.object(baseShape);

// Variables requises uniquement par la synchronisation (login auto + base), pas par le serveur MCP.
const syncSchema = z.object({
  ...baseShape,
  CESI_EMAIL: z.email(),
  CESI_PASSWORD: z.string().min(1),
  // Facultatif : sinon découvert sur la page emploi du temps après le login.
  CESI_CODE_PERSONNE: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(/^\d+$/, 'chaîne de chiffres attendue').optional(),
  ),
  CESI_SCHEDULE_WEEKS: z.coerce.number().int().min(1).max(8).default(DEFAULT_SCHEDULE_WEEKS),
  CESI_HEADLESS: boolFlag(false),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/, 'URL postgres:// attendue'),
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

export function loadConfig(env = process.env) {
  return Object.freeze(baseConfig(parseEnv(schema, env)));
}

export function loadSyncConfig(env = process.env) {
  const parsed = parseEnv(syncSchema, env);
  // Le mot de passe est non énumérable : absent de JSON.stringify, console.log et spread.
  const credentials = { email: parsed.CESI_EMAIL };
  Object.defineProperty(credentials, 'password', { value: parsed.CESI_PASSWORD });
  return Object.freeze({
    ...baseConfig(parsed),
    credentials: Object.freeze(credentials),
    codePersonne: parsed.CESI_CODE_PERSONNE,
    scheduleWeeks: parsed.CESI_SCHEDULE_WEEKS,
    headless: parsed.CESI_HEADLESS,
    databaseUrl: parsed.DATABASE_URL,
  });
}

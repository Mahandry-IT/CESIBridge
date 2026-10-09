import { z } from 'zod';

const DEFAULT_STATE_PATH = './data/state.json';
const DEFAULT_NAV_TIMEOUT_MS = 30_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;

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

const schema = z.object({
  CESI_ENT_URL: z.url({ protocol: /^https?$/ }),
  CESI_LOGGED_IN_HOSTS: hostList,
  CESI_STATE_PATH: z.string().min(1).default(DEFAULT_STATE_PATH),
  CESI_NAV_TIMEOUT_MS: timeout(DEFAULT_NAV_TIMEOUT_MS),
  CESI_LOGIN_TIMEOUT_MS: timeout(DEFAULT_LOGIN_TIMEOUT_MS),
});

export class ConfigError extends Error {
  name = 'ConfigError';
}

export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')} : ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Configuration invalide :\n${details}`);
  }
  const parsed = result.data;
  return Object.freeze({
    entUrl: parsed.CESI_ENT_URL,
    loggedInHosts: Object.freeze(parsed.CESI_LOGGED_IN_HOSTS),
    statePath: parsed.CESI_STATE_PATH,
    navTimeoutMs: parsed.CESI_NAV_TIMEOUT_MS,
    loginTimeoutMs: parsed.CESI_LOGIN_TIMEOUT_MS,
  });
}

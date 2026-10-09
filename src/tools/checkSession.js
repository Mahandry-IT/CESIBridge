import { errors } from 'playwright';
import { z } from 'zod';
import { checkLoggedIn } from '../browser/sso.js';
import { loadState, StateError } from '../browser/session.js';
import { LOGIN_COMMAND } from '../commands.js';
import { log } from '../log.js';

const RELOGIN_HINT = `Lance le login : \`${LOGIN_COMMAND}\` (ou l'outil cesi_login).`;

/** Message d'erreur sûr : jamais le message brut de Playwright (il peut contenir des URL à jetons). */
function describeFailure(error, timeoutMs) {
  if (error instanceof errors.TimeoutError) {
    return `ENT injoignable : délai de ${Math.round(timeoutMs / 1000)} s dépassé.`;
  }
  if (/net::ERR_/.test(error?.message ?? '')) {
    return 'ENT injoignable : erreur réseau.';
  }
  return 'Vérification impossible : erreur interne du navigateur.';
}

/**
 * @returns {Promise<{ status: 'valid'|'expired'|'absent'|'invalid'|'error', message: string }>}
 */
export async function checkSession({ config, getBrowser }) {
  let state;
  try {
    state = await loadState(config.statePath);
  } catch (error) {
    if (!(error instanceof StateError)) throw error;
    return { status: 'invalid', message: `${error.message}. ${RELOGIN_HINT}` };
  }
  if (!state) {
    return { status: 'absent', message: `Aucune session enregistrée. ${RELOGIN_HINT}` };
  }

  let context;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({ storageState: state });
    const page = await context.newPage();
    const { loggedIn, host } = await checkLoggedIn(page, {
      entUrl: config.entUrl,
      loggedInHosts: config.loggedInHosts,
      timeoutMs: config.navTimeoutMs,
    });
    return loggedIn
      ? { status: 'valid', message: `Session valide (hôte final : ${host}).` }
      : { status: 'expired', message: `Session expirée (redirigé vers ${host}). ${RELOGIN_HINT}` };
  } catch (error) {
    log('cesi_check_session a échoué :', error?.name ?? 'Error');
    return { status: 'error', message: describeFailure(error, config.navTimeoutMs) };
  } finally {
    await context?.close().catch(() => {});
  }
}

export function registerCheckSession(server, deps) {
  server.registerTool(
    'cesi_check_session',
    {
      title: 'Vérifier la session CESI',
      description:
        "Vérifie si la session SSO CESI enregistrée est encore valide en chargeant l'ENT en headless.",
      outputSchema: {
        status: z.enum(['valid', 'expired', 'absent', 'invalid', 'error']),
        message: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const result = await checkSession(deps);
      return {
        content: [{ type: 'text', text: result.message }],
        structuredContent: result,
        isError: result.status === 'error',
      };
    },
  );
}

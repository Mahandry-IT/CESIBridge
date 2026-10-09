// Le code personne n'est exposé par aucune API dédiée : la page emploi du temps l'envoie elle-même
// à /api/seance/all au chargement. On intercepte cette requête plutôt que de parser son HTML.
const SCHEDULE_PAGE_PATH = '/mon-emploi-du-temps';
const SEANCES_API_PATH = '/api/seance/all';

export class CodePersonneError extends Error {
  name = 'CodePersonneError';
}

/** Extrait `codePersonne` d'une URL de l'API des séances, ou `null`. */
export function extractCodePersonne(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.pathname !== SEANCES_API_PATH) return null;
  const code = url.searchParams.get('codePersonne');
  return code && /^\d+$/.test(code) ? code : null;
}

/** Ouvre la page emploi du temps (session déjà valide) et lit le code personne dans sa requête API. */
export async function discoverCodePersonne(page, { entUrl, timeoutMs }) {
  try {
    const [request] = await Promise.all([
      page.waitForRequest((req) => extractCodePersonne(req.url()) !== null, { timeout: timeoutMs }),
      page.goto(new URL(SCHEDULE_PAGE_PATH, entUrl).href, { timeout: timeoutMs }),
    ]);
    return extractCodePersonne(request.url());
  } catch (error) {
    if (error.name !== 'TimeoutError') throw new CodePersonneError('code personne introuvable');
    throw new CodePersonneError(
      'code personne introuvable sur la page emploi du temps : définir CESI_CODE_PERSONNE',
    );
  }
}

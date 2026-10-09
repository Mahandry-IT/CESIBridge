import { z } from 'zod';
import { isLoggedInHost } from '../browser/sso.js';

const REQUEST_TIMEOUT_MS = 30_000;

export class SessionExpiredError extends Error {
  name = 'SessionExpiredError';
}

export class ScheduleError extends Error {
  name = 'ScheduleError';
}

const seancesSchema = z.array(z.looseObject({}));

/**
 * Récupère les séances d'une semaine. 204 = semaine vide.
 * Lève `SessionExpiredError` si la session n'est plus valide (401/403, redirection SSO, réponse non JSON).
 * Les messages ne contiennent jamais l'URL (elle porte le code personne) ni le corps de la réponse.
 */
export async function fetchWeek(request, { entUrl, loggedInHosts, codePersonne, range }) {
  const url = new URL('/api/seance/all', entUrl);
  url.search = new URLSearchParams({
    start: range.start,
    end: range.end,
    codePersonne,
  }).toString();

  const response = await request.get(url.toString(), {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { accept: 'application/json' },
  });
  const status = response.status();
  if (status === 204) return [];
  if (status === 401 || status === 403) throw new SessionExpiredError('session expirée');
  // Redirection suivie vers le SSO : l'hôte final n'est plus un hôte « connecté ».
  if (!isLoggedInHost(response.url(), loggedInHosts)) {
    throw new SessionExpiredError('session expirée');
  }
  if (!response.ok()) throw new ScheduleError(`API séances : statut HTTP ${status}`);

  let body;
  try {
    body = await response.json();
  } catch {
    // Page de login HTML renvoyée à la place du JSON.
    throw new SessionExpiredError('réponse non JSON (session expirée ?)');
  }
  const parsed = seancesSchema.safeParse(body);
  if (!parsed.success) throw new ScheduleError('API séances : tableau JSON attendu');
  return parsed.data;
}

/** Une semaine, avec un unique nouvel essai après `onExpired` (reconnexion) si la session a expiré. */
export async function fetchWeekWithRetry(request, params, onExpired) {
  try {
    return await fetchWeek(request, params);
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) throw error;
    // La reconnexion crée un nouveau contexte : on réessaie avec son `request`.
    return fetchWeek(await onExpired(), params);
  }
}

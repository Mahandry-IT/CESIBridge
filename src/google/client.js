import { SOURCE } from './event.js';

const API_BASE = 'https://www.googleapis.com/calendar/v3';
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
const CALL_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 250;
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

export class GoogleError extends Error {
  name = 'GoogleError';
  constructor(message, { status, reason } = {}) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Seul le `reason` du premier motif d'erreur est lu : ni le corps complet, ni le jeton ne sont jamais repris.
async function readReason(response) {
  try {
    const body = await response.json();
    const reason = body?.error?.errors?.[0]?.reason;
    return typeof reason === 'string' ? reason : undefined;
  } catch {
    return undefined;
  }
}

const isRetryable = (status, reason) =>
  status === 429 || status >= 500 || (status === 403 && RATE_LIMIT_REASONS.has(reason));

/**
 * Client minimal de l'API Google Calendar v3 (REST). `fetch`, `getToken` et `sleep` sont injectables.
 * `getToken` renvoie un jeton d'accès (chaîne).
 */
export function createCalendarClient({
  calendarId,
  getToken,
  fetch: fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  timeoutMs = CALL_TIMEOUT_MS,
}) {
  const eventsUrl = `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;

  // Renvoie la réponse ; `tolerate` liste des statuts d'échec acceptés par l'appelant (409, 404...).
  async function call(method, url, { body, tolerate = [] } = {}) {
    for (let attempt = 1; ; attempt += 1) {
      // Hors du try : une erreur de clé ou d'authentification n'est pas une erreur réseau.
      const token = await getToken();
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // Réseau ou délai dépassé : message générique, l'erreur d'origine peut citer l'URL.
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
          continue;
        }
        const cause = error?.name === 'TimeoutError' ? 'délai dépassé' : 'erreur réseau';
        throw new GoogleError(`Google Calendar injoignable (${cause})`);
      }
      if (response.ok || tolerate.includes(response.status)) return response;
      const reason = await readReason(response);
      if (isRetryable(response.status, reason) && attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      // 404 sur la liste = agenda inconnu du compte de service (mauvais ID ou agenda non partagé).
      const hint =
        response.status === 404 && method === 'GET'
          ? ' : agenda introuvable, vérifier GOOGLE_CALENDAR_ID et son partage avec le compte de service'
          : '';
      throw new GoogleError(
        `Google Calendar : HTTP ${response.status}${reason ? ` (${reason})` : ''}${hint}`,
        { status: response.status, reason },
      );
    }
  }

  return {
    /** Événements créés par CESIBridge (flux `source`) sur `[timeMin, timeMax[` (instants `Date`), toutes pages. */
    async listEvents(timeMin, timeMax, source = SOURCE) {
      const events = [];
      let pageToken;
      do {
        const query = new URLSearchParams({
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          privateExtendedProperty: `source=${source}`,
          singleEvents: 'true',
          showDeleted: 'false',
          maxResults: String(PAGE_SIZE),
        });
        if (pageToken) query.set('pageToken', pageToken);
        const response = await call('GET', `${eventsUrl}?${query}`);
        const page = await response.json();
        events.push(...(page.items ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return events;
    },

    async updateEvent(event) {
      await call('PUT', `${eventsUrl}/${encodeURIComponent(event.id)}`, {
        body: { ...event, status: 'confirmed' },
      });
    },

    /** Insère l'événement ; si l'identifiant existe déjà (409, y compris supprimé), le met à jour. */
    async upsertEvent(event) {
      const response = await call('POST', eventsUrl, { body: event, tolerate: [409] });
      if (response.status === 409) await this.updateEvent(event);
    },

    /** Supprime un événement ; déjà absent (404/410) = succès. */
    async deleteEvent(id) {
      await call('DELETE', `${eventsUrl}/${encodeURIComponent(id)}`, { tolerate: [404, 410] });
    },
  };
}

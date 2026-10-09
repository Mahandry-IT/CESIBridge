import { ScheduleError } from './client.js';

// L'API renvoie un décalage sur deux chiffres (`+02`), que `Date` refuse : on le complète en `+02:00`.
const SHORT_OFFSET = /([+-]\d{2})$/;

function parseDate(value) {
  const date = new Date(String(value).replace(SHORT_OFFSET, '$1:00'));
  return Number.isNaN(date.getTime()) ? null : date;
}

const textOrNull = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function sallesOf(raw) {
  if (!Array.isArray(raw.salles)) return null;
  return textOrNull(
    raw.salles
      .map((salle) => textOrNull(salle?.nomSalle))
      .filter(Boolean)
      .join(', '),
  );
}

/**
 * Seul endroit qui connaît le format d'une séance de l'API ENT :
 * `{ code, title, start, end, matiere, nomModule, salles: [{ nomSalle }], … }`, dates en `2026-10-05T08:30:00+02`.
 */
export function mapSeance(raw, codePersonne) {
  const missing = ['code', 'start', 'end'].filter(
    (key) => textOrNull(String(raw?.[key] ?? '')) === null,
  );
  if (missing.length > 0) {
    // Uniquement les noms des clés, jamais les valeurs.
    const found = raw && typeof raw === 'object' ? Object.keys(raw).sort().join(', ') : 'aucune';
    throw new ScheduleError(
      `Séance au format inattendu : champs manquants (${missing.join(', ')}) ; clés trouvées : ${found}`,
    );
  }
  const debut = parseDate(raw.start);
  const fin = parseDate(raw.end);
  if (!debut || !fin) {
    throw new ScheduleError('Séance au format inattendu : start/end ne sont pas des dates');
  }
  return {
    id: String(raw.code),
    codePersonne,
    debut,
    fin,
    titre: textOrNull(raw.title),
    matiere: textOrNull(raw.matiere),
    module: textOrNull(raw.nomModule),
    salles: sallesOf(raw),
    raw,
  };
}

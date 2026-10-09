import { ScheduleError } from './client.js';

// L'API renvoie un décalage sur deux chiffres (`+02`), que `Date` refuse : on le complète en `+02:00`.
const SHORT_OFFSET = /([+-]\d{2})$/;

function parseDate(value) {
  const date = new Date(String(value).replace(SHORT_OFFSET, '$1:00'));
  return Number.isNaN(date.getTime()) ? null : date;
}

const textOrNull = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

// Dédoublonne par clé et ignore les éléments sans clé ; `build` produit l'élément retenu.
function uniqueBy(list, keyOf, build) {
  const found = new Map();
  if (!Array.isArray(list)) return [];
  for (const item of list) {
    const key = textOrNull(item?.[keyOf]);
    if (key !== null && !found.has(key)) found.set(key, build(item, key));
  }
  return [...found.values()];
}

const sallesOf = (raw) => uniqueBy(raw.salles, 'nomSalle', (_salle, nom) => nom);

// Seuls code, nom, prénom et sous-titre sont conservés : jamais l'adresse e-mail ni les autres champs.
const intervenantsOf = (raw) =>
  uniqueBy(raw.intervenants, 'code', (item, code) => ({
    code,
    nom: textOrNull(item.nom),
    prenom: textOrNull(item.prenom),
    sousTitre: textOrNull(item.sousTitre),
  }));

const groupesOf = (raw) =>
  uniqueBy(raw.participants, 'codeGroupe', (item, code) => ({
    code,
    libelle: textOrNull(item.libelleGroupe),
    codeSession: textOrNull(item.codeSession),
  }));

/**
 * Seul endroit qui connaît le format d'une séance de l'API ENT :
 * `{ code, title, start, end, matiere, nomModule, salles, intervenants, participants, … }`, dates en `2026-10-05T08:30:00+02`.
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
    code: String(raw.code).trim(),
    codePersonne,
    titre: textOrNull(raw.title),
    matiere: textOrNull(raw.matiere),
    module: textOrNull(raw.nomModule),
    theme: textOrNull(raw.theme),
    debut,
    fin,
    allDay: raw.allDay === true,
    nightly: raw.nightly === true,
    url: textOrNull(raw.url),
    salles: sallesOf(raw),
    intervenants: intervenantsOf(raw),
    groupes: groupesOf(raw),
  };
}

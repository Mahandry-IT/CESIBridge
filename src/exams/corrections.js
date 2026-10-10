// Corrections manuelles de la lecture OCR : un fichier JSON facultatif, appliqué après chaque lecture.
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { ExamError } from './errors.js';
import { claimId, examId, matchKey } from './parse.js';

const MAX_REPORTED_ISSUES = 5;
const BOM = /^\uFEFF/;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isRealDay = (value) => {
  if (!DAY.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
};

const text = z.string().trim().min(1);
const optionalText = text.nullable();
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'heure HH:MM attendue')
  .nullable();
const fields = {
  element: text,
  bloc: optionalText,
  format: optionalText,
  plateforme: optionalText,
  session: optionalText,
  date: z.string().refine(isRealDay, 'date AAAA-MM-JJ existante attendue'),
  debut: time,
  fin: time,
};
const match = z.strictObject({ element: text, session: text.optional() });

const setEntry = z.strictObject({
  match,
  set: z
    .strictObject(fields)
    .partial()
    .refine((value) => Object.keys(value).length > 0, 'au moins un champ attendu'),
});
const removeEntry = z.strictObject({ match, remove: z.literal(true) });
const addEntry = z.strictObject({
  add: z
    .strictObject(fields)
    .partial({ bloc: true, format: true, plateforme: true, session: true, debut: true, fin: true }),
});

// Le schéma est choisi d'après la clé qui distingue l'entrée : les erreurs désignent alors le bon champ.
function schemaOf(entry) {
  if (entry !== null && typeof entry === 'object' && 'add' in entry) return addEntry;
  if (entry !== null && typeof entry === 'object' && 'remove' in entry) return removeEntry;
  return setEntry;
}

// Nom du champ et règle violée seulement : jamais la valeur, ni une clé inconnue recopiée du fichier.
const describeIssue = (index, issue) =>
  `  - [${[index, ...issue.path].join('.')}] : ${
    issue.code === 'unrecognized_keys' ? 'clé non reconnue' : issue.message
  }`;

function invalid(issues) {
  const shown = issues.slice(0, MAX_REPORTED_ISSUES);
  const more =
    issues.length > shown.length ? `\n  - … et ${issues.length - shown.length} autre(s)` : '';
  return new ExamError(`fichier de corrections invalide :\n${shown.join('\n')}${more}`);
}

/** Valide le texte JSON du fichier ; `ExamError` si le JSON ou une entrée est invalide. */
export function parseCorrections(source) {
  const json = source.replace(BOM, '');
  if (json.trim() === '') return [];
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    // Le message de `JSON.parse` cite un extrait du contenu : on ne le reprend pas.
    throw new ExamError('fichier de corrections invalide : JSON mal formé');
  }
  if (!Array.isArray(raw)) throw invalid(['  - un tableau d’entrées est attendu']);
  const results = raw.map((entry) => schemaOf(entry).safeParse(entry));
  const issues = results.flatMap((result, index) =>
    result.success ? [] : result.error.issues.map((issue) => describeIssue(index, issue)),
  );
  if (issues.length > 0) throw invalid(issues);
  return results.map((result) => result.data);
}

/** `{ entries, text }` du fichier de corrections ; fichier absent → aucune correction. */
export async function loadCorrections(path) {
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { entries: [], text: '' };
    throw new ExamError(`fichier de corrections illisible (${error.code ?? 'erreur'})`);
  }
  return { entries: parseCorrections(source), text: source };
}

const matcher = ({ element, session }) => {
  const elementKey = matchKey(element);
  const sessionKey = session === undefined ? null : matchKey(session);
  return (exam) =>
    matchKey(exam.element) === elementKey &&
    (sessionKey === null || matchKey(exam.session) === sessionKey);
};

const without = (flags, flag) => flags.filter((value) => value !== flag);

// Une valeur saisie à la main n'est plus « à vérifier » ; un libellé corrigé change l'identifiant.
function corrected(exam, set, scope, taken) {
  const next = { ...exam, ...set };
  if ('date' in set) next.aVerifier = without(next.aVerifier, 'date');
  if ('debut' in set || 'fin' in set) next.aVerifier = without(next.aVerifier, 'horaire');
  if ('element' in set || 'session' in set) {
    taken.delete(exam.id);
    next.id = claimId(examId(scope, next.element, next.session), taken);
  }
  return next;
}

function added(add, scope, taken) {
  const exam = {
    bloc: null,
    format: null,
    plateforme: null,
    session: null,
    debut: null,
    fin: null,
    ...add,
  };
  return {
    id: claimId(examId(scope, exam.element, exam.session), taken),
    filiere: scope.filiere,
    niveau: scope.niveau,
    annee: scope.annee,
    ...exam,
    aVerifier: [],
  };
}

const byDateThenStart = (a, b) =>
  a.date.localeCompare(b.date) || (a.debut ?? '').localeCompare(b.debut ?? '');

/**
 * Applique les corrections dans l'ordre du fichier. Renvoie `{ exams, unmatched }` : examens triés par
 * date puis heure de début, et les `match` qui ne désignent aucun examen (à journaliser).
 * Un `match` sans `session` vise toutes les sessions de l'élément.
 */
export function applyCorrections(exams, entries, scope) {
  let current = exams.map((exam) => ({ ...exam }));
  const unmatched = [];
  for (const entry of entries) {
    const taken = new Set(current.map((exam) => exam.id));
    if (entry.add) {
      current.push(added(entry.add, scope, taken));
      continue;
    }
    const hits = new Set(current.filter(matcher(entry.match)));
    if (hits.size === 0) {
      unmatched.push(entry.match);
    } else if (entry.remove) {
      current = current.filter((exam) => !hits.has(exam));
    } else {
      current = current.map((exam) =>
        hits.has(exam) ? corrected(exam, entry.set, scope, taken) : exam,
      );
    }
  }
  return { exams: current.sort(byDateThenStart), unmatched };
}

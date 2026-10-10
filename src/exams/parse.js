// Lignes brutes lues par l'OCR -> examens validés. Pur : aucune lecture d'image ni d'horloge.
import { createHash } from 'node:crypto';

const ID_LENGTH = 20;
// Ordre stable des drapeaux « à vérifier ».
const FLAGS = Object.freeze(['date', 'horaire']);
const SESSIONS = Object.freeze(['Initiale', 'Rattrapage']);
const SESSION_MAX_DISTANCE = 2;
// Une erreur de lecture tolérée par tranche de 6 lettres : « FISA » n'est pas « FISE »,
// mais « Informatiaue » reste « Informatique ».
const LETTERS_PER_TYPO = 6;
const CLEAN_WORD = /^[\p{L}\p{N}]+$/u;
const UNREADABLE_ELEMENT = 'Examen (libellé illisible)';
const YEAR = /^(\d{4})-(\d{4})$/;
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const TIME = /^(\d{1,2})h(\d{2})$/;
// Sigles que Tesseract lit de travers : « I.A. » (LA. |A. lA., ou « l'A. » pour « l'I.A. »)
// et « S.I. » (S.l. S.|. S.!.).
const MISREAD_IA = /(^|[^\p{L}])(?:LA|\|A|lA)\./gu;
const ELIDED_IA = /(?<=\p{L}')A\./gu;
const MISREAD_SI = /S\.[l|!](?:\.|(?=\s))/g;
const TYPOGRAPHIC_APOSTROPHE = /[\u2018\u2019]/g;

/**
 * Clé de comparaison tolérante : sans casse, accents, espaces ni ponctuation, et sans distinguer
 * les caractères que l'OCR confond (I l 1 | !, O 0).
 */
export function matchKey(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[l1|!]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/[^a-z0-9]/g, '');
}

/** Identifiant stable d'un examen : la date n'y entre pas, un report déplace l'événement au lieu de le dupliquer. */
export function examId({ filiere, niveau, annee }, element, session) {
  const key = [filiere, niveau, annee, matchKey(element), matchKey(session)].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, ID_LENGTH);
}

/** Réserve `base` dans `taken`, suffixé par son rang d'occurrence (`-2`, `-3`…) s'il est déjà pris. */
export function claimId(base, taken) {
  let id = base;
  for (let rank = 2; taken.has(id); rank++) id = `${base}-${rank}`;
  taken.add(id);
  return id;
}

function distance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

const sameWord = (word, expected) =>
  distance(word, expected) <= Math.floor(expected.length / LETTERS_PER_TYPO);

// Les mots lus se retrouvent-ils, dans l'ordre, parmi les mots attendus ?
function isSubsequence(words, expected) {
  let from = 0;
  for (const word of words) {
    const found = expected.findIndex((target, index) => index >= from && sameWord(word, target));
    if (found === -1) return false;
    from = found + 1;
  }
  return true;
}

// `match` : la formation attendue. `other` : un libellé net qui en désigne une autre.
// `unreadable` : vide, tronqué ou bruité — on ne peut pas l'écarter.
function formationStatus(formation, expected) {
  const words = String(formation ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const keys = words.map(matchKey).filter(Boolean);
  if (keys.length === 0) return 'unreadable';
  if (keys.join('') === expected.join('')) return 'match';
  if (isSubsequence(keys, expected)) {
    return keys.length === expected.length ? 'match' : 'unreadable';
  }
  return words.every((word) => CLEAN_WORD.test(word)) ? 'other' : 'unreadable';
}

const clean = (text) =>
  String(text ?? '')
    .replace(TYPOGRAPHIC_APOSTROPHE, "'")
    .replace(MISREAD_IA, '$1I.A.')
    .replace(ELIDED_IA, 'I.A.')
    .replace(MISREAD_SI, 'S.I.')
    .replace(/\s+/g, ' ')
    .trim();

function normalizeSession(text) {
  const session = clean(text);
  if (!session) return null;
  const key = matchKey(session);
  const known = SESSIONS.find((name) => distance(key, matchKey(name)) <= SESSION_MAX_DISTANCE);
  return known ?? session;
}

// Année scolaire `AAAA-AAAA` : du 1er septembre au 31 août.
function schoolYear(annee) {
  const match = YEAR.exec(annee);
  if (!match) throw new RangeError(`Année scolaire invalide : ${annee}`);
  return { start: `${match[1]}-09-01`, end: `${match[2]}-08-31` };
}

// `JJ/MM/AAAA` -> `YYYY-MM-DD` si le jour existe et tombe dans l'année scolaire, sinon `null`.
function parseDate(text, year) {
  const match = DATE.exec(String(text ?? '').trim());
  if (!match) return null;
  const [, day, month, fullYear] = match;
  const iso = `${fullYear}-${month}-${day}`;
  const real = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== iso) return null;
  return iso >= year.start && iso <= year.end ? iso : null;
}

// Le tableau est trié par date : une date illisible prend celle de la ligne précédente (à défaut,
// la première date valide, puis la rentrée) ; une date qui recule est gardée mais signalée.
function resolveDates(dates, year) {
  const first = dates.find(Boolean) ?? year.start;
  let previous = null;
  return dates.map((date) => {
    const resolved = date ?? previous ?? first;
    const flagged = date === null || (previous !== null && date < previous);
    previous = resolved;
    return { date: resolved, flagged };
  });
}

function parseTime(text) {
  const match = TIME.exec(text);
  if (!match || Number(match[1]) >= 24 || Number(match[2]) >= 60) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

// Sans aucune heure : examen sur la journée. Une seule heure, ou un créneau incohérent : journée, signalée.
function resolveTimes(row) {
  const [start, end] = [row.debut, row.fin].map((value) => String(value ?? '').trim());
  if (!start && !end) return { debut: null, fin: null, flagged: false };
  const debut = parseTime(start);
  const fin = parseTime(end);
  if (!debut || !fin || fin <= debut) return { debut: null, fin: null, flagged: true };
  return { debut, fin, flagged: false };
}

function toExam(row, day, scope, taken) {
  const element = clean(row.element) || UNREADABLE_ELEMENT;
  const session = normalizeSession(row.session);
  const times = resolveTimes(row);
  const doubts = new Set(row.flags ?? []);
  if (day.flagged) doubts.add('date');
  if (times.flagged) doubts.add('horaire');
  return {
    id: claimId(examId(scope, element, session), taken),
    filiere: scope.filiere,
    niveau: scope.niveau,
    annee: scope.annee,
    element,
    bloc: clean(row.bloc) || null,
    format: clean(row.format) || null,
    plateforme: clean(row.plateforme) || null,
    session,
    date: day.date,
    debut: times.debut,
    fin: times.fin,
    aVerifier: FLAGS.filter((flag) => doubts.has(flag)),
  };
}

/**
 * Examens de la formation `filiere niveau` parmi les lignes lues, dans l'ordre du tableau.
 * Rien n'est jeté sur un doute : une ligne à la formation illisible est gardée, une valeur douteuse
 * est remplacée par la plus prudente et signalée dans `aVerifier`.
 */
export function parseExams(rows, scope) {
  const year = schoolYear(scope.annee);
  const expected = `${scope.filiere} ${scope.niveau}`.split(/\s+/).map(matchKey).filter(Boolean);
  const kept = rows.filter((row) => formationStatus(row.formation, expected) !== 'other');
  const days = resolveDates(
    kept.map((row) => parseDate(row.date, year)),
    year,
  );
  const taken = new Set();
  return kept.map((row, index) => toExam(row, days[index], scope, taken));
}

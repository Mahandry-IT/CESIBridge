// Rattache un examen à son cours Moodle d'après son bloc de formation (« [A3 FISE info] Algorithmique »).
const BLOC_PREFIX = /^\s*\[[^\]]*\]\s*/;

// Mots comparables : sans accents ni casse, sigles recollés (« S.I. » -> « si »), ponctuation en espaces.
const wordsOf = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const hasWords = (haystack, words) => words !== '' && ` ${haystack} `.includes(` ${words} `);

// « 2026-2027 » s'écrit aussi « 2026 2027 » ou « 26-27 » dans les noms de cours.
function hasYear(name, annee) {
  const [from, to] = String(annee).split('-');
  return hasWords(name, `${from} ${to}`) || hasWords(name, `${from.slice(2)} ${to.slice(2)}`);
}

/**
 * Lien du cours de `courses` (`{ name, url }`) dont le nom contient le niveau, l'année et le sujet du bloc.
 * `null` si aucun ou plusieurs cours correspondent : pas de lien plutôt qu'un lien approximatif.
 */
export function courseUrlFor(bloc, courses, { niveau, annee }) {
  const topic = wordsOf(String(bloc ?? '').replace(BLOC_PREFIX, ''));
  const matches = courses.filter(({ name, url }) => {
    const words = wordsOf(name);
    return (
      url && hasWords(words, wordsOf(niveau)) && hasYear(words, annee) && hasWords(words, topic)
    );
  });
  return matches.length === 1 ? matches[0].url : null;
}

/** Examens complétés de `coursUrl` (ou `null`). */
export function linkCourses(exams, courses, scope) {
  return exams.map((exam) => ({ ...exam, coursUrl: courseUrlFor(exam.bloc, courses, scope) }));
}

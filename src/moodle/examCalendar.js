import { MoodleError } from './errors.js';

const SESSION_CATEGORY = 'ma session';
const GENERAL_SECTION = 'generalites';
const CALENDAR_ACTIVITY = 'calendrier des examens';

// Insensible à la casse, aux accents et aux espaces multiples (noms saisis à la main côté Moodle).
function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesLevel(name, niveau) {
  const level = normalize(niveau);
  if (!level) return true;
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(level)}(?![a-z0-9])`).test(normalize(name));
}

// « 2026-2027 » est aussi reconnu sous les formes « 2026 2027 » et « 26-27 ».
function matchesYear(name, annee) {
  const match = /^\s*(\d{4})\s*[-/ ]\s*(\d{4})\s*$/.exec(String(annee ?? ''));
  if (!match) return true;
  const [, from, to] = match;
  const pattern = `(?<!\\d)(?:${from}|${from.slice(2)})\\s*[-/ ]\\s*(?:${to}|${to.slice(2)})(?!\\d)`;
  return new RegExp(pattern).test(String(name ?? ''));
}

function describeCandidates(courses) {
  return courses.map((course) => `« ${course.name} »`).join(', ');
}

/** Cours de la catégorie « Ma session », départagés par niveau puis année ; sinon `MoodleError`. */
export function selectSessionCourse(courses, { niveau, annee } = {}) {
  const sessions = courses.filter((course) => normalize(course.category) === SESSION_CATEGORY);
  if (sessions.length === 0) throw new MoodleError('aucun cours de la catégorie « Ma session »');
  if (sessions.length === 1) return sessions[0];
  const matching = sessions.filter(
    (course) => matchesLevel(course.name, niveau) && matchesYear(course.name, annee),
  );
  if (matching.length === 1) return matching[0];
  const reason = matching.length === 0 ? 'aucun ne correspond' : 'plusieurs correspondent';
  throw new MoodleError(
    `cours « Ma session » ambigus (${reason} à ${niveau} ${annee}) : ${describeCandidates(
      matching.length === 0 ? sessions : matching,
    )}`,
  );
}

const isCalendar = (activity) =>
  activity.type === 'resource' && normalize(activity.name).includes(CALENDAR_ACTIVITY);

/** Ressource « Calendrier des examens » : section « Généralités » d'abord, sinon toutes les sections. */
export function selectExamCalendarActivity(sections) {
  const general = sections.filter((section) => normalize(section.name).includes(GENERAL_SECTION));
  const found =
    general.flatMap((section) => section.activities).find(isCalendar) ??
    sections.flatMap((section) => section.activities).find(isCalendar);
  if (!found) throw new MoodleError('ressource « Calendrier des examens » introuvable');
  if (!found.url) throw new MoodleError('ressource « Calendrier des examens » sans lien');
  return found;
}

import { base32hex, TIMEZONE } from '../google/event.js';
import { nextDay, parisMidnight } from '../schedule/weeks.js';

// Source et préfixe distincts de ceux des cours : `publishWeek` ne voit ni ne supprime jamais un examen.
export const EXAM_SOURCE = 'cesibridge-exam';
const ID_PREFIX = 'cesiepreuve';
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Identifiant stable : toujours encodé en base32hex (l'id d'examen est arbitraire). */
export const examEventId = (exam) => `${ID_PREFIX}${base32hex(String(exam.id))}`;

const minutesOf = (time) => {
  const match = TIME.exec(time ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

function when(exam) {
  const start = minutesOf(exam.debut);
  const end = minutesOf(exam.fin);
  // Horaire douteux ou incohérent : mieux vaut un événement sur la journée qu'une heure fausse.
  if (start === null || end === null || end <= start || exam.aVerifier.includes('horaire')) {
    // `end.date` est exclusif.
    return { start: { date: exam.date }, end: { date: nextDay(exam.date) } };
  }
  const midnight = parisMidnight(exam.date).getTime();
  const at = (minutes) => ({
    dateTime: new Date(midnight + minutes * 60_000).toISOString(),
    timeZone: TIMEZONE,
  });
  return { start: at(start), end: at(end) };
}

function description(exam, imageUrl) {
  const lines = [
    ['Bloc', exam.bloc],
    ['Format', exam.format],
    ['Session', exam.session],
    ['Plateforme', exam.plateforme],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label} : ${value}`);
  if (exam.aVerifier.length > 0) {
    lines.push(`À vérifier (lecture automatique) : ${exam.aVerifier.join(', ')}`);
  }
  if (exam.coursUrl) lines.push(`Cours : ${exam.coursUrl}`);
  if (imageUrl) lines.push(`Calendrier d'origine : ${imageUrl}`);
  return lines.join('\n');
}

function summary(exam) {
  const retake = exam.session?.toLowerCase() === 'rattrapage' ? '[Rattrapage] ' : '';
  return `${exam.aVerifier.length > 0 ? '⚠ ' : ''}${retake}${exam.element}`;
}

/** Examen -> ressource événement Google Calendar. */
export function toExamEvent(exam, { imageUrl } = {}) {
  return {
    id: examEventId(exam),
    status: 'confirmed',
    summary: summary(exam),
    description: description(exam, imageUrl),
    ...when(exam),
    extendedProperties: { private: { source: EXAM_SOURCE, code: exam.id } },
  };
}

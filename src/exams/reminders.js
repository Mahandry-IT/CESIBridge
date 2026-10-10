// Rappel systématique, en plus des jours configurés.
export const WEEK_REMINDER_DAYS = 7;
const DAY_MS = 86_400_000;

// Écart en jours entre deux dates civiles `YYYY-MM-DD` : calculé en UTC, donc sans décalage horaire.
const utcDay = (date) => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
const daysBetween = (from, to) => Math.round((utcDay(to) - utcDay(from)) / DAY_MS);

const byDateThenTime = (a, b) =>
  a.date.localeCompare(b.date) || (a.debut ?? '').localeCompare(b.debut ?? '');

/**
 * Rappels à envoyer aujourd'hui : `[{ exam, restant, seuils }]`, triés par date puis heure.
 * `days` : jours configurés (le rappel à 7 jours s'ajoute toujours) ; `today` : `YYYY-MM-DD` (Paris) ;
 * `sent` : résultat de `listSentReminders`. Un seul rappel par examen, même si plusieurs seuils sont
 * atteints (outil non lancé pendant des jours) : `seuils` liste ceux à marquer comme envoyés.
 */
export function dueReminders(exams, { days, today, sent }) {
  const thresholds = [...new Set([...days, WEEK_REMINDER_DAYS])].sort((a, b) => a - b);
  const done = new Set(sent.map(({ examId, jours, date }) => `${examId}|${jours}|${date}`));
  return exams
    .map((exam) => {
      const restant = daysBetween(today, exam.date);
      const seuils =
        restant < 0
          ? []
          : thresholds.filter(
              (jours) => jours >= restant && !done.has(`${exam.id}|${jours}|${exam.date}`),
            );
      return { exam, restant, seuils };
    })
    .filter(({ seuils }) => seuils.length > 0)
    .sort((a, b) => byDateThenTime(a.exam, b.exam));
}

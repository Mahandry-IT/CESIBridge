import { listSentReminders, markRemindersSent } from '../db/rappels.js';
import { log as defaultLog } from '../log.js';
import { buildReminderMail } from '../mail/reminderMail.js';
import { parisDate } from '../schedule/weeks.js';
import { dueReminders } from './reminders.js';

/**
 * Envoie par e-mail les rappels d'examen dus aujourd'hui (date de Paris). Renvoie `{ sent }`, le nombre
 * d'examens notifiés. Les rappels ne sont marqués qu'après un envoi réussi ; si le marquage échoue ensuite,
 * l'erreur remonte : mieux vaut un doublon au prochain passage qu'un rappel perdu.
 */
export async function sendExamReminders({
  pool,
  mailer,
  exams,
  days,
  imageUrl,
  now = new Date(),
  log = defaultLog,
}) {
  const sent = await listSentReminders(
    pool,
    exams.map((exam) => exam.id),
  );
  const due = dueReminders(exams, { days, today: parisDate(now), sent });
  if (due.length === 0) {
    log('Rappels : aucun rappel à envoyer.');
    return { sent: 0 };
  }
  await mailer.send(buildReminderMail(due, { imageUrl }));
  await markRemindersSent(
    pool,
    due.flatMap(({ exam, seuils }) =>
      seuils.map((jours) => ({ examId: exam.id, jours, date: exam.date })),
    ),
  );
  return { sent: due.length };
}

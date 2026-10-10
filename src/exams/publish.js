import { diffEvents } from '../google/event.js';
import { startOf } from '../google/publish.js';
import { nextDay, parisMidnight } from '../schedule/weeks.js';
import { EXAM_SOURCE, sameExamEvent, toExamEvent } from './event.js';

const YEAR = /^(\d{4})-(\d{4})$/;

// Année scolaire [1er sept., 1er sept.[ en heure de Paris, élargie aux examens hors fenêtre :
// sinon l'un d'eux serait recréé en boucle (409 -> mise à jour) sans jamais être nettoyé.
function windowOf(annee, exams) {
  const match = YEAR.exec(annee);
  if (!match) throw new RangeError(`Année scolaire invalide : ${annee}`);
  let from = parisMidnight(`${match[1]}-09-01`);
  let to = parisMidnight(`${match[2]}-09-01`);
  for (const { date } of exams) {
    const start = parisMidnight(date);
    const end = parisMidnight(nextDay(date));
    if (start < from) from = start;
    if (end > to) to = end;
  }
  return { from, to };
}

/** Aligne l'agenda Google sur les examens d'une année scolaire. Renvoie `{ created, updated, deleted }`. */
export async function publishExams(client, annee, exams, { reminderDays = [], imageUrl } = {}) {
  const { from, to } = windowOf(annee, exams);
  const listed = await client.listEvents(from, to, EXAM_SOURCE);
  const existing = listed.filter((event) => {
    const start = startOf(event);
    return start >= from.getTime() && start < to.getTime();
  });
  const desired = exams.map((exam) => toExamEvent(exam, { reminderDays, imageUrl }));
  const { toCreate, toUpdate, toDelete } = diffEvents(desired, existing, {
    source: EXAM_SOURCE,
    same: sameExamEvent,
  });
  for (const event of toCreate) await client.upsertEvent(event);
  for (const event of toUpdate) await client.updateEvent(event);
  for (const id of toDelete) await client.deleteEvent(id);
  return { created: toCreate.length, updated: toUpdate.length, deleted: toDelete.length };
}

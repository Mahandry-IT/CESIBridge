import { parisMidnight, weekBounds } from '../schedule/weeks.js';
import { diffEvents, toEvent } from './event.js';

// Début d'un événement existant, pour ignorer ceux qui chevauchent seulement la semaine voisine.
export const startOf = (event) => {
  if (event.start?.dateTime) return Date.parse(event.start.dateTime);
  return event.start?.date ? parisMidnight(event.start.date).getTime() : Number.NaN;
};

/**
 * Aligne l'agenda Google sur les séances d'une semaine (`range` = `{ start, end }`).
 * Renvoie `{ created, updated, deleted }`.
 */
export async function publishWeek(client, range, seances) {
  const { from, to } = weekBounds(range);
  const listed = await client.listEvents(from, to);
  const existing = listed.filter((event) => {
    const start = startOf(event);
    return start >= from.getTime() && start < to.getTime();
  });
  const { toCreate, toUpdate, toDelete } = diffEvents(seances.map(toEvent), existing);
  for (const event of toCreate) await client.upsertEvent(event);
  for (const event of toUpdate) await client.updateEvent(event);
  for (const id of toDelete) await client.deleteEvent(id);
  return { created: toCreate.length, updated: toUpdate.length, deleted: toDelete.length };
}

export const formatCounts = ({ created, updated, deleted }) =>
  `Google +${created} ~${updated} −${deleted}`;

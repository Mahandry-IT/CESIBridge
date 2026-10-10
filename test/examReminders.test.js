import { describe, expect, it } from 'vitest';
import { dueReminders } from '../src/exams/reminders.js';

const exam = (override = {}) => ({
  id: 'ex-1',
  element: 'Algorithmique',
  date: '2026-11-05',
  debut: '08:45',
  ...override,
});
const sentFor = (jours, e = exam()) => jours.map((j) => ({ examId: e.id, jours: j, date: e.date }));
const due = (today, { days = [1, 3], sent = [], exams = [exam()] } = {}) =>
  dueReminders(exams, { days, today, sent }).map(({ restant, seuils }) => ({ restant, seuils }));

describe('dueReminders', () => {
  it('ne rappelle rien à J-10', () => {
    expect(due('2026-10-26')).toEqual([]);
  });

  it('rappelle à J-7 avec le seuil 7, puis plus rien après marquage', () => {
    expect(due('2026-10-29')).toEqual([{ restant: 7, seuils: [7] }]);
    expect(due('2026-10-29', { sent: sentFor([7]) })).toEqual([]);
  });

  it('rattrape à J-5 par un seul rappel (seuil 7)', () => {
    expect(due('2026-10-31')).toEqual([{ restant: 5, seuils: [7] }]);
  });

  it('regroupe en un seul rappel à J-2 sans rien d’envoyé', () => {
    expect(due('2026-11-03')).toEqual([{ restant: 2, seuils: [3, 7] }]);
  });

  it('à J-1 ne garde que les seuils restants', () => {
    expect(due('2026-11-04', { sent: sentFor([7, 3]) })).toEqual([{ restant: 1, seuils: [1] }]);
  });

  it('rappelle le jour J si un seuil manque, rien le lendemain', () => {
    expect(due('2026-11-05', { sent: sentFor([7, 3]) })).toEqual([{ restant: 0, seuils: [1] }]);
    expect(due('2026-11-05', { sent: sentFor([7, 3, 1]) })).toEqual([]);
    expect(due('2026-11-06')).toEqual([]);
  });

  it('rappelle de nouveau un examen reporté', () => {
    const moved = exam({ date: '2026-11-12' });
    expect(due('2026-11-05', { sent: sentFor([7, 3, 1]), exams: [moved] })).toEqual([
      { restant: 7, seuils: [7] },
    ]);
  });

  it('dédoublonne le 7 déjà configuré', () => {
    expect(due('2026-11-04', { days: [7, 7, 1] })).toEqual([{ restant: 1, seuils: [1, 7] }]);
  });

  it('ne dépend pas du changement d’heure', () => {
    // Fin octobre 2026 : passage à l’heure d’hiver entre ces deux dates.
    expect(due('2026-10-24', { exams: [exam({ date: '2026-10-31' })] })).toEqual([
      { restant: 7, seuils: [7] },
    ]);
  });

  it('trie par date puis par heure', () => {
    const exams = [
      exam({ id: 'c', date: '2026-11-05', debut: '14:00' }),
      exam({ id: 'b', date: '2026-11-05', debut: '08:00' }),
      exam({ id: 'a', date: '2026-11-04', debut: '16:00' }),
    ];
    const result = dueReminders(exams, { days: [], today: '2026-11-04', sent: [] });
    expect(result.map(({ exam: e }) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

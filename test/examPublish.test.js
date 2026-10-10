import { describe, expect, it, vi } from 'vitest';
import { examEventId, toExamEvent } from '../src/exams/event.js';
import { publishExams } from '../src/exams/publish.js';

const exam = (id, date = '2026-11-05') => ({
  id,
  annee: '2026-2027',
  element: `Examen ${id}`,
  bloc: null,
  format: null,
  plateforme: null,
  session: null,
  date,
  debut: '08:45',
  fin: '09:40',
  aVerifier: [],
});

const fakeClient = (listed = []) => ({
  listEvents: vi.fn(async () => listed),
  upsertEvent: vi.fn(async () => {}),
  updateEvent: vi.fn(async () => {}),
  deleteEvent: vi.fn(async () => {}),
});

describe('publishExams', () => {
  it('liste la source examens sur l’année scolaire de Paris', async () => {
    const client = fakeClient();
    await publishExams(client, '2026-2027', []);
    const [from, to, source] = client.listEvents.mock.calls[0];
    expect(from.toISOString()).toBe('2026-08-31T22:00:00.000Z');
    expect(to.toISOString()).toBe('2027-08-31T22:00:00.000Z');
    expect(source).toBe('cesibridge-exam');
  });

  it('crée, met à jour et supprime', async () => {
    const kept = toExamEvent(exam('a'), { reminderDays: [1] });
    const stale = toExamEvent(exam('b'), { reminderDays: [1] });
    const old = toExamEvent(exam('c'), { reminderDays: [1] });
    const client = fakeClient([kept, { ...stale, summary: 'Ancien titre' }, old]);
    const result = await publishExams(client, '2026-2027', [exam('a'), exam('b'), exam('d')], {
      reminderDays: [1],
    });

    expect(result).toEqual({ created: 1, updated: 1, deleted: 1 });
    expect(client.upsertEvent.mock.calls[0][0].id).toBe(examEventId(exam('d')));
    expect(client.updateEvent.mock.calls[0][0].id).toBe(examEventId(exam('b')));
    expect(client.deleteEvent).toHaveBeenCalledWith(examEventId(exam('c')));
  });

  it('met à jour tous les examens quand les rappels changent', async () => {
    const client = fakeClient([toExamEvent(exam('a'), { reminderDays: [1] })]);
    const result = await publishExams(client, '2026-2027', [exam('a')], { reminderDays: [2] });
    expect(result).toEqual({ created: 0, updated: 1, deleted: 0 });
  });

  it('ne supprime pas un événement d’une autre source', async () => {
    const course = { id: 'cesiabc', start: { dateTime: '2026-11-05T08:00:00Z' } };
    const client = fakeClient([
      { ...course, extendedProperties: { private: { source: 'cesibridge' } } },
    ]);
    const result = await publishExams(client, '2026-2027', []);
    expect(result.deleted).toBe(0);
    expect(client.deleteEvent).not.toHaveBeenCalled();
  });

  it('élargit la fenêtre à un examen hors année scolaire', async () => {
    const client = fakeClient();
    await publishExams(client, '2026-2027', [exam('a', '2027-09-02'), exam('b', '2026-08-20')]);
    const [from, to] = client.listEvents.mock.calls[0];
    expect(from.toISOString()).toBe('2026-08-19T22:00:00.000Z');
    expect(to.toISOString()).toBe('2027-09-02T22:00:00.000Z');
  });

  it('refuse une année scolaire invalide', async () => {
    await expect(publishExams(fakeClient(), '2026', [])).rejects.toThrow(RangeError);
  });
});

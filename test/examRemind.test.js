import { describe, expect, it, vi } from 'vitest';
import { sendExamReminders } from '../src/exams/remind.js';

const exam = (override = {}) => ({
  id: 'ex-1',
  element: 'Algorithmique',
  date: '2026-11-05',
  debut: '08:45',
  fin: '09:40',
  aVerifier: [],
  ...override,
});

// Faux pool : `SELECT` renvoie les rappels déjà envoyés, `INSERT` est journalisé.
function fakePool({ sent = [], failInsert = false } = {}) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      const text = String(sql).trim();
      calls.push({ text: text.split(/\s+/)[0], params });
      if (text.startsWith('INSERT') && failInsert) throw new Error('base indisponible');
      if (!text.startsWith('SELECT')) return { rows: [] };
      return { rows: sent.map((s) => ({ exam_id: s.examId, jours: s.jours, date: s.date })) };
    }),
  };
}

const run = (overrides) =>
  sendExamReminders({
    exams: [exam()],
    days: [1],
    imageUrl: 'https://moodle.cesi.fr/cal.png',
    // 2026-10-29 à 12:00 à Paris : J-7.
    now: new Date('2026-10-29T11:00:00Z'),
    log: vi.fn(),
    ...overrides,
  });

describe('sendExamReminders', () => {
  it('ne fait rien et le journalise quand rien n’est dû', async () => {
    const pool = fakePool();
    const mailer = { send: vi.fn() };
    const log = vi.fn();
    const result = await run({ pool, mailer, log, now: new Date('2026-10-01T10:00:00Z') });
    expect(result).toEqual({ sent: 0 });
    expect(mailer.send).not.toHaveBeenCalled();
    expect(pool.calls.map((c) => c.text)).toEqual(['SELECT']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('aucun rappel'));
  });

  it('envoie le mail puis marque les seuils envoyés', async () => {
    const pool = fakePool();
    const order = [];
    const mailer = { send: vi.fn(async () => order.push('send')) };
    pool.query.mockImplementationOnce(async () => ({ rows: [] }));
    pool.query.mockImplementationOnce(async () => {
      order.push('mark');
      return { rows: [] };
    });
    const result = await run({ pool, mailer });
    expect(result).toEqual({ sent: 1 });
    expect(order).toEqual(['send', 'mark']);
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringMatching(/^\[CESI Examen\] J-7 : /) }),
    );
    expect(pool.query.mock.calls[1][1]).toEqual([['ex-1'], [7], ['2026-11-05']]);
  });

  it('ne marque rien quand l’envoi échoue', async () => {
    const pool = fakePool();
    const mailer = { send: vi.fn(async () => Promise.reject(new Error('smtp'))) };
    await expect(run({ pool, mailer })).rejects.toThrow('smtp');
    expect(pool.calls.map((c) => c.text)).toEqual(['SELECT']);
  });

  it('remonte l’erreur si le marquage échoue après l’envoi', async () => {
    const pool = fakePool({ failInsert: true });
    const mailer = { send: vi.fn(async () => {}) };
    await expect(run({ pool, mailer })).rejects.toThrow('base indisponible');
    expect(mailer.send).toHaveBeenCalledOnce();
  });

  it('ne renvoie pas un rappel déjà marqué', async () => {
    const pool = fakePool({ sent: [{ examId: 'ex-1', jours: 7, date: '2026-11-05' }] });
    const mailer = { send: vi.fn() };
    expect(await run({ pool, mailer })).toEqual({ sent: 0 });
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('utilise la date de Paris, pas celle d’UTC', async () => {
    // 2026-10-28 23:30 UTC = 2026-10-29 00:30 à Paris : J-7.
    const pool = fakePool();
    const mailer = { send: vi.fn(async () => {}) };
    const result = await run({ pool, mailer, now: new Date('2026-10-28T23:30:00Z') });
    expect(result).toEqual({ sent: 1 });
  });
});

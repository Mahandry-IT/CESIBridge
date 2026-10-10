import { describe, expect, it } from 'vitest';
import { listSentReminders, markRemindersSent } from '../src/db/rappels.js';

// Faux pool pg : mémorise la dernière requête et renvoie des lignes prédéfinies.
function fakePool(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ text: String(sql).replace(/\s+/g, ' ').trim(), params });
      return { rows, rowCount: rows.length };
    },
  };
}

describe('listSentReminders', () => {
  it('convertit les lignes, date formatée côté SQL', async () => {
    const pool = fakePool([{ exam_id: 'a', jours: 7, date: '2026-11-05' }]);
    expect(await listSentReminders(pool, ['a', 'b'])).toEqual([
      { examId: 'a', jours: 7, date: '2026-11-05' },
    ]);
    expect(pool.calls[0].text).toMatch(/to_char\(jour, 'YYYY-MM-DD'\) AS date/);
    expect(pool.calls[0].params).toEqual([['a', 'b']]);
  });

  it('n’interroge pas la base sans examen', async () => {
    const pool = fakePool();
    expect(await listSentReminders(pool, [])).toEqual([]);
    expect(pool.calls).toHaveLength(0);
  });
});

describe('markRemindersSent', () => {
  it('insère en une requête, sans doublon en cas de conflit', async () => {
    const pool = fakePool();
    await markRemindersSent(pool, [
      { examId: 'a', jours: 7, date: '2026-11-05' },
      { examId: 'a', jours: 3, date: '2026-11-05' },
    ]);
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].text).toMatch(/ON CONFLICT DO NOTHING$/);
    expect(pool.calls[0].params).toEqual([
      ['a', 'a'],
      [7, 3],
      ['2026-11-05', '2026-11-05'],
    ]);
  });

  it('ne fait rien sans rappel', async () => {
    const pool = fakePool();
    await markRemindersSent(pool, []);
    expect(pool.calls).toHaveLength(0);
  });
});

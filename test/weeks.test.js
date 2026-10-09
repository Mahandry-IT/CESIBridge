import { describe, expect, it } from 'vitest';
import { weekRanges } from '../src/schedule/weeks.js';

describe('weekRanges', () => {
  it('renvoie lundi → dimanche de la semaine courante (mercredi)', () => {
    expect(weekRanges(new Date('2026-10-07T10:00:00Z'), 1)).toEqual([
      { start: '2026-10-05', end: '2026-10-11' },
    ]);
  });

  it('un lundi et un dimanche restent dans leur semaine', () => {
    expect(weekRanges(new Date('2026-10-05T10:00:00Z'), 1)[0].start).toBe('2026-10-05');
    expect(weekRanges(new Date('2026-10-11T10:00:00Z'), 1)[0].start).toBe('2026-10-05');
  });

  it('utilise la date de Paris, pas celle d’UTC', () => {
    // Dimanche 23:30 UTC = lundi 01:30 à Paris (heure d'été).
    expect(weekRanges(new Date('2026-10-04T23:30:00Z'), 1)[0].start).toBe('2026-10-05');
  });

  it('traverse le changement d’heure de fin octobre (25 octobre 2026)', () => {
    expect(weekRanges(new Date('2026-10-20T10:00:00Z'), 2)).toEqual([
      { start: '2026-10-19', end: '2026-10-25' },
      { start: '2026-10-26', end: '2026-11-01' },
    ]);
  });

  it('traverse le changement d’année', () => {
    expect(weekRanges(new Date('2026-12-30T10:00:00Z'), 2)).toEqual([
      { start: '2026-12-28', end: '2027-01-03' },
      { start: '2027-01-04', end: '2027-01-10' },
    ]);
  });

  it('gère N=1 et N=8 avec des semaines contiguës', () => {
    expect(weekRanges(new Date('2026-10-07T10:00:00Z'), 1)).toHaveLength(1);
    const weeks = weekRanges(new Date('2026-10-07T10:00:00Z'), 8);
    expect(weeks).toHaveLength(8);
    expect(weeks[7]).toEqual({ start: '2026-11-23', end: '2026-11-29' });
  });
});

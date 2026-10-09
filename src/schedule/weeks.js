const TIMEZONE = 'Europe/Paris';
const DAY_MS = 86_400_000;

const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const iso = (utcMs) => new Date(utcMs).toISOString().slice(0, 10);

/**
 * Semaines (lundi → dimanche, `YYYY-MM-DD`) à partir de la semaine courante en heure de Paris.
 * Le calcul se fait sur des dates calendaires (midi UTC) : insensible aux changements d'heure.
 */
export function weekRanges(now, count) {
  const [year, month, day] = dateFormat.format(now).split('-').map(Number);
  const today = Date.UTC(year, month - 1, day, 12);
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const monday = today - sinceMonday * DAY_MS;
  return Array.from({ length: count }, (_, index) => ({
    start: iso(monday + index * 7 * DAY_MS),
    end: iso(monday + (index * 7 + 6) * DAY_MS),
  }));
}

const hourFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Date calendaire (`YYYY-MM-DD`) d'un instant, en heure de Paris. */
export const parisDate = (instant) => dateFormat.format(instant);

/**
 * Instant correspondant à minuit (heure de Paris) au début du jour `YYYY-MM-DD`.
 * Paris est à UTC+1 ou UTC+2 ; le changement d'heure a lieu la nuit, jamais à minuit.
 */
export function parisMidnight(day) {
  const [year, month, date] = day.split('-').map(Number);
  for (const offsetHours of [1, 2]) {
    const candidate = new Date(Date.UTC(year, month - 1, date) - offsetHours * 3_600_000);
    const parts = Object.fromEntries(
      hourFormat.formatToParts(candidate).map((part) => [part.type, part.value]),
    );
    if (parts.hour === '00' && parts.day === String(date).padStart(2, '0')) return candidate;
  }
  throw new RangeError(`Jour invalide : ${day}`);
}

/** Jour calendaire suivant (`YYYY-MM-DD`). */
export const nextDay = (day) => iso(Date.parse(`${day}T12:00:00Z`) + DAY_MS);

/** Bornes `[from, to[` d'une semaine `{ start, end }` : minuit de Paris du premier jour et du lendemain du dernier. */
export function weekBounds(range) {
  return { from: parisMidnight(range.start), to: parisMidnight(nextDay(range.end)) };
}

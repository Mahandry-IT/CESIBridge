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

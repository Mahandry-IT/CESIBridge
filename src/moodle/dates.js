const PARIS_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

/** Horodatage Unix (s) → ISO 8601 à l'heure de Paris (`2026-10-12T23:59:00+02:00`) ; null si absent. */
export function toParisIso(epochSeconds) {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return null;
  const parts = Object.fromEntries(
    PARIS_FORMAT.formatToParts(new Date(epochSeconds * 1000)).map(({ type, value }) => [
      type,
      value,
    ]),
  );
  // `GMT+02:00`, ou `GMT` seul quand le décalage est nul.
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.slice(3);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

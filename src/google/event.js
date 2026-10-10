import { nextDay, parisDate } from '../schedule/weeks.js';

export const TIMEZONE = 'Europe/Paris';
export const SOURCE = 'cesibridge';
const ID_PREFIX = 'cesi';
const DEFAULT_SUMMARY = 'Cours CESI';

// Alphabet base32hex (minuscules) : le seul que Google accepte pour un identifiant d'événement.
const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';
const VALID_ID_BODY = /^[a-v0-9]+$/;

export function base32hex(text) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of Buffer.from(text, 'utf8')) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Identifiant stable d'événement : `cesi` + code de séance (idempotence des republications).
 * Un code contenant autre chose que [a-v0-9] est encodé en base32hex.
 */
export function eventId(code) {
  const body = VALID_ID_BODY.test(code) ? code : base32hex(code);
  return `${ID_PREFIX}${body}`;
}

const dateTimeOf = (instant) => ({ dateTime: instant.toISOString(), timeZone: TIMEZONE });

function allDayRange(seance) {
  const start = parisDate(seance.debut);
  let end = parisDate(seance.fin);
  // `end.date` est exclusif.
  if (end <= start) end = nextDay(start);
  return { start: { date: start }, end: { date: end } };
}

function description(seance) {
  const people = seance.intervenants
    .map((i) => [i.nom, i.prenom].filter(Boolean).join(' '))
    .filter(Boolean);
  const groups = seance.groupes.map((g) => g.libelle ?? g.code);
  const lines = [
    ['Module', seance.module],
    // La matière sert de titre quand le thème manque : inutile de la répéter ici.
    ['Thème', seance.theme ? seance.matiere : null],
    ['Intervenant(s)', people.join(', ')],
    ['Groupe(s)', groups.join(', ')],
  ];
  return lines
    .filter(([, value]) => value)
    .map(([label, value]) => `${label} : ${value}`)
    .join('\n');
}

/** Séance (forme de `mapSeance`/`listWeek`) -> ressource événement Google Calendar. */
export function toEvent(seance) {
  const when = seance.allDay
    ? allDayRange(seance)
    : { start: dateTimeOf(seance.debut), end: dateTimeOf(seance.fin) };
  return {
    id: eventId(seance.code),
    status: 'confirmed',
    summary: seance.theme ?? seance.matiere ?? seance.titre ?? DEFAULT_SUMMARY,
    location: seance.salles.join(', '),
    description: description(seance),
    ...when,
    extendedProperties: { private: { source: SOURCE, code: seance.code } },
  };
}

// Google renvoie `dateTime` avec un décalage (`+02:00`) : on compare des instants, pas des chaînes.
const instantOf = (when) => {
  if (when?.dateTime) return `t:${Date.parse(when.dateTime)}`;
  if (when?.date) return `d:${when.date}`;
  return '';
};

// Uniquement les champs gérés par CESIBridge ; les autres (rappels, couleur…) ne déclenchent pas de mise à jour.
export function managed(event) {
  const priv = event.extendedProperties?.private ?? {};
  return JSON.stringify([
    event.status ?? 'confirmed',
    event.summary ?? '',
    event.location ?? '',
    event.description ?? '',
    instantOf(event.start),
    instantOf(event.end),
    priv.source ?? '',
    priv.code ?? '',
  ]);
}

/**
 * Compare les événements voulus et existants (par `id`) : `{ toCreate, toUpdate, toDelete }`.
 * `source` borne les suppressions aux événements de ce flux ; `same` décide si deux versions sont équivalentes.
 */
export function diffEvents(
  desired,
  existing,
  { source = SOURCE, same = (a, b) => managed(a) === managed(b) } = {},
) {
  const current = new Map(existing.map((event) => [event.id, event]));
  const wanted = new Set(desired.map((event) => event.id));
  const toCreate = [];
  const toUpdate = [];
  for (const event of desired) {
    const found = current.get(event.id);
    if (!found) toCreate.push(event);
    else if (!same(found, event)) toUpdate.push(event);
  }
  // Double garde en plus du filtre `privateExtendedProperty` : jamais un événement non créé par nous.
  const toDelete = existing
    .filter(
      (event) => event.extendedProperties?.private?.source === source && !wanted.has(event.id),
    )
    .map((event) => event.id);
  return { toCreate, toUpdate, toDelete };
}

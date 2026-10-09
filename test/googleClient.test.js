import { describe, expect, it, vi } from 'vitest';
import { createCalendarClient, GoogleError } from '../src/google/client.js';
import { publishWeek } from '../src/google/publish.js';

const json = (status, body = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(...responses) {
  const queue = [...responses];
  const fetch = vi.fn(async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async () => {});
  const client = createCalendarClient({
    calendarId: 'a@group.calendar.google.com',
    getToken: async () => 'TOKEN',
    fetch,
    sleep,
  });
  return { client, fetch, sleep };
}

const event = { id: 'cesiabc', summary: 'X' };

describe('listEvents', () => {
  it('pagine et filtre sur la propriété privée', async () => {
    const { client, fetch } = setup(
      json(200, { items: [{ id: '1' }], nextPageToken: 'p2' }),
      json(200, { items: [{ id: '2' }] }),
    );
    const items = await client.listEvents(
      new Date('2026-10-04T22:00:00Z'),
      new Date('2026-10-11T22:00:00Z'),
    );

    expect(items.map((e) => e.id)).toEqual(['1', '2']);
    const first = new URL(fetch.mock.calls[0][0]);
    expect(first.pathname).toBe('/calendar/v3/calendars/a%40group.calendar.google.com/events');
    expect(first.searchParams.get('privateExtendedProperty')).toBe('source=cesibridge');
    expect(first.searchParams.get('singleEvents')).toBe('true');
    expect(first.searchParams.get('maxResults')).toBe('250');
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('pageToken')).toBe('p2');
    expect(fetch.mock.calls[0][1].headers.authorization).toBe('Bearer TOKEN');
  });
});

describe('upsertEvent', () => {
  it('passe en PUT confirmé sur un 409', async () => {
    const { client, fetch } = setup(json(409), json(200));
    await client.upsertEvent({ ...event, status: 'confirmed' });

    expect(fetch.mock.calls.map((c) => c[1].method)).toEqual(['POST', 'PUT']);
    expect(fetch.mock.calls[1][0]).toContain('/events/cesiabc');
    expect(JSON.parse(fetch.mock.calls[1][1].body).status).toBe('confirmed');
  });
});

describe('deleteEvent', () => {
  it.each([404, 410])('accepte un %i', async (status) => {
    const { client } = setup(json(status));
    await expect(client.deleteEvent('cesiabc')).resolves.toBeUndefined();
  });
});

describe('retry', () => {
  it.each([
    [429, {}],
    [503, {}],
    [403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }],
    [403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }],
  ])('réessaie sur %i avec backoff', async (status, body) => {
    const { client, fetch, sleep } = setup(json(status, body), json(status, body), json(200));
    await client.deleteEvent('x');

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
  });

  it('abandonne après 3 essais sans fuite du jeton ni du corps', async () => {
    const body = { error: { message: 'secret TOKEN', errors: [{ reason: 'backendError' }] } };
    const { client, fetch } = setup(json(500, body), json(500, body), json(500, body));
    const error = await client.deleteEvent('x').catch((e) => e);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(GoogleError);
    expect(error.status).toBe(500);
    expect(error.message).toBe('Google Calendar : HTTP 500 (backendError)');
  });

  it('ne réessaie pas un 403 hors quota', async () => {
    const { client, fetch } = setup(json(403, { error: { errors: [{ reason: 'forbidden' }] } }));
    await expect(client.deleteEvent('x')).rejects.toThrow(/403 \(forbidden\)/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('réessaie une erreur réseau puis la signale sans détail', async () => {
    const boom = new TypeError('fetch failed https://secret');
    const { client, fetch } = setup(boom, boom, boom);
    const error = await client.deleteEvent('x').catch((e) => e);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(error.message).toBe('Google Calendar injoignable (erreur réseau)');
  });
});

describe('publishWeek', () => {
  it('ignore les événements voisins et supprime les obsolètes', async () => {
    const tagged = { extendedProperties: { private: { source: 'cesibridge' } } };
    const client = {
      listEvents: vi.fn(async () => [
        { id: 'cesiold', start: { dateTime: '2026-10-06T08:30:00+02:00' }, ...tagged },
        { id: 'cesiprev', start: { dateTime: '2026-10-03T08:30:00+02:00' }, ...tagged },
      ]),
      upsertEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
    };
    const seance = {
      code: 'abc',
      titre: null,
      matiere: 'M',
      module: null,
      theme: null,
      debut: new Date('2026-10-05T06:30:00Z'),
      fin: new Date('2026-10-05T08:00:00Z'),
      allDay: false,
      salles: [],
      intervenants: [],
      groupes: [],
    };

    const counts = await publishWeek(client, { start: '2026-10-05', end: '2026-10-11' }, [seance]);

    expect(counts).toEqual({ created: 1, updated: 0, deleted: 1 });
    expect(client.deleteEvent).toHaveBeenCalledExactlyOnceWith('cesiold');
  });
});

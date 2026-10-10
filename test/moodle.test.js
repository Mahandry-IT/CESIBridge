import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createMoodleClient, parseServiceResponse } from '../src/moodle/client.js';
import { toParisIso } from '../src/moodle/dates.js';
import { MoodleError } from '../src/moodle/errors.js';
import { mapCourses, mapCourseState, mapEvents } from '../src/moodle/mappers.js';

const fixture = (name) =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'));

describe('toParisIso', () => {
  it.each([
    [1760392800, '2025-10-14T00:00:00+02:00'], // heure d'été
    [1767135600, '2025-12-31T00:00:00+01:00'], // heure d'hiver
    [0, null],
    [undefined, null],
  ])('%s -> %s', (input, expected) => {
    expect(toParisIso(input)).toBe(expected);
  });
});

describe('mapCourses', () => {
  it('convertit les cours et neutralise les liens hors Moodle', () => {
    const [algo, projet] = mapCourses(fixture('moodle-courses.json'));

    expect(algo).toEqual({
      id: 101,
      name: 'Algorithmique avancée',
      shortName: 'ALGO-A',
      category: 'Informatique',
      url: 'https://moodle.cesi.fr/course/view.php?id=101',
      startDate: '2025-09-01T00:00:00+02:00',
      endDate: '2025-12-31T00:00:00+01:00',
      progress: 43,
    });
    expect(projet).toMatchObject({ url: null, endDate: null, progress: null });
  });

  it('tronque les textes longs', () => {
    const [course] = mapCourses({ courses: [{ id: 1, fullname: 'x'.repeat(2000) }] });

    expect(course.name).toHaveLength(500);
  });

  it('réponse inattendue : MoodleError', () => {
    expect(() => mapCourses({ courses: [{ id: 'abc' }] })).toThrow(MoodleError);
  });
});

describe('mapEvents', () => {
  it('trie par échéance et renvoie des types simples', () => {
    const events = mapEvents(fixture('moodle-events.json'), new Date('2025-10-12T12:00:00Z'));

    expect(events.map((event) => event.name)).toEqual([
      'Rendu TP',
      'Quiz 1',
      'Événement sans activité',
    ]);
    expect(events[0]).toEqual({
      courseId: 101,
      courseName: 'Algorithmique avancée',
      name: 'Rendu TP',
      type: 'assign',
      due: '2025-10-09T00:00:00+02:00',
      url: 'https://moodle.cesi.fr/mod/assign/view.php?id=5001',
      overdue: true,
    });
    // Sans `overdue` fourni : comparé à maintenant. Lien non Moodle neutralisé.
    expect(events[2]).toMatchObject({ courseId: null, overdue: false, url: null });
  });
});

describe('mapCourseState', () => {
  it('sections et activités visibles, ids entiers, type technique', () => {
    const sections = mapCourseState(JSON.stringify(fixture('moodle-course-state.json')));

    expect(sections).toEqual([
      {
        id: 11,
        name: 'Généralités',
        activities: [
          {
            id: 201,
            name: 'Support de cours',
            type: 'resource',
            url: 'https://moodle.cesi.fr/mod/resource/view.php?id=201',
          },
          { id: 202, name: 'Consigne', type: 'label', url: null },
        ],
      },
      {
        id: 12,
        name: 'Bloc 1',
        activities: [
          {
            id: 204,
            name: 'Quiz',
            type: 'quiz',
            url: 'https://moodle.cesi.fr/mod/quiz/view.php?id=204',
          },
        ],
      },
    ]);
  });

  it.each([['pas du JSON'], [42], [JSON.stringify({ section: 'x' })]])(
    'réponse inattendue : MoodleError (%s)',
    (data) => {
      expect(() => mapCourseState(data)).toThrow(MoodleError);
    },
  );
});

describe('parseServiceResponse', () => {
  it('renvoie les données du premier appel', () => {
    expect(parseServiceResponse([{ error: false, data: { ok: 1 } }])).toEqual({ ok: 1 });
  });

  it.each([
    [[{ error: true, exception: { errorcode: 'invalidrecord', message: 'x' } }], 'invalidrecord'],
    [{ error: 'Session expirée', errorcode: 'servicerequireslogin' }, 'servicerequireslogin'],
  ])('erreur Moodle → MoodleError avec errorcode', (body, code) => {
    const error = (() => {
      try {
        parseServiceResponse(body);
      } catch (e) {
        return e;
      }
    })();

    expect(error).toBeInstanceOf(MoodleError);
    expect(error.errorcode).toBe(code);
  });

  it.each([[[]], ['texte'], [null]])('forme inattendue → MoodleError', (body) => {
    expect(() => parseServiceResponse(body)).toThrow(MoodleError);
  });
});

function fakeResponse(body, status = 200) {
  return { status: () => status, json: async () => body };
}

describe('createMoodleClient', () => {
  const SESSKEY = 'abcDEF123';

  function setup(responses) {
    const request = { post: vi.fn(async () => responses.shift()) };
    const open = vi.fn(async () => ({ sesskey: SESSKEY, wwwroot: 'https://moodle.cesi.fr' }));
    return { client: createMoodleClient({ request, open }), request, open };
  }

  it('POST service.php avec sesskey, info et corps attendu', async () => {
    const { client, request, open } = setup([fakeResponse([{ error: false, data: [1] }])]);

    await expect(client.call('core_x_y', { a: 1 })).resolves.toEqual([1]);

    const [url, options] = request.post.mock.calls[0];
    expect(new URL(url).pathname).toBe('/lib/ajax/service.php');
    expect(new URL(url).searchParams.get('info')).toBe('core_x_y');
    expect(options.data).toEqual([{ index: 0, methodname: 'core_x_y', args: { a: 1 } }]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('invalidsesskey : rouvre Moodle et réessaie une seule fois', async () => {
    const expired = fakeResponse([{ error: true, exception: { errorcode: 'invalidsesskey' } }]);
    const { client, request, open } = setup([
      expired,
      fakeResponse([{ error: false, data: 'ok' }]),
    ]);

    await expect(client.call('core_x_y', {})).resolves.toBe('ok');
    expect(open).toHaveBeenCalledTimes(2);
    expect(request.post).toHaveBeenCalledTimes(2);
  });

  it('erreur de session répétée : pas de troisième essai', async () => {
    const expired = () =>
      fakeResponse([{ error: true, exception: { errorcode: 'requireloginerror' } }]);
    const { client, request } = setup([expired(), expired(), expired()]);

    await expect(client.call('core_x_y', {})).rejects.toMatchObject({
      errorcode: 'requireloginerror',
    });
    expect(request.post).toHaveBeenCalledTimes(2);
  });

  it('autre erreur Moodle : pas de nouvel essai', async () => {
    const { client, request } = setup([
      fakeResponse([{ error: true, exception: { errorcode: 'invalidrecord' } }]),
    ]);

    await expect(client.call('core_x_y', {})).rejects.toBeInstanceOf(MoodleError);
    expect(request.post).toHaveBeenCalledTimes(1);
  });

  it('erreur réseau : message sans URL ni sesskey', async () => {
    const { client, request } = setup([]);
    request.post.mockRejectedValueOnce(
      new Error(`apiRequestContext.post: boom https://moodle.cesi.fr/?sesskey=${SESSKEY}`),
    );

    const error = await client.call('core_x_y', {}).catch((e) => e);

    expect(error).toBeInstanceOf(MoodleError);
    expect(error.message).not.toContain(SESSKEY);
    expect(error.message).not.toContain('https://');
  });

  it('statut HTTP inattendu ou réponse non JSON : MoodleError', async () => {
    const notJson = { status: () => 200, json: async () => JSON.parse('<html>') };
    const { client } = setup([fakeResponse(null, 303), notJson]);

    await expect(client.call('core_x_y', {})).rejects.toThrow(/statut HTTP 303/);
    await expect(client.call('core_x_y', {})).rejects.toThrow(/non JSON/);
  });

  it('refuse un nom de méthode invalide', async () => {
    const { client, request } = setup([]);

    await expect(client.call('../x', {})).rejects.toBeInstanceOf(MoodleError);
    expect(request.post).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  fetchWeek,
  fetchWeekWithRetry,
  ScheduleError,
  SessionExpiredError,
} from '../src/schedule/client.js';
import { mapSeance } from '../src/schedule/mapping.js';

const params = {
  entUrl: 'https://ent.example.fr/',
  loggedInHosts: ['ent.example.fr'],
  codePersonne: '123',
  range: { start: '2026-10-05', end: '2026-10-11' },
};

const response = ({ status = 200, url = 'https://ent.example.fr/api/seance/all', json } = {}) => ({
  status: () => status,
  ok: () => status >= 200 && status < 300,
  url: () => url,
  json: json ?? (async () => []),
});
const requestOf = (...responses) => {
  const get = vi.fn();
  for (const r of responses) get.mockResolvedValueOnce(r);
  return { get };
};

describe('fetchWeek', () => {
  it('renvoie les séances (200) et construit l’URL attendue', async () => {
    const request = requestOf(response({ json: async () => [{ id: 1 }] }));

    expect(await fetchWeek(request, params)).toEqual([{ id: 1 }]);
    const url = new URL(request.get.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/seance/all');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      start: '2026-10-05',
      end: '2026-10-11',
      codePersonne: '123',
    });
  });

  it('204 donne une semaine vide', async () => {
    expect(await fetchWeek(requestOf(response({ status: 204 })), params)).toEqual([]);
  });

  it.each([
    ['401', response({ status: 401 })],
    ['403', response({ status: 403 })],
    ['redirection SSO', response({ url: 'https://sts.example.fr/adfs' })],
    [
      'JSON invalide',
      response({
        json: async () => {
          throw new SyntaxError('x');
        },
      }),
    ],
  ])('session expirée : %s', async (_label, res) => {
    await expect(fetchWeek(requestOf(res), params)).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('erreur sans fuite du code personne pour un statut inattendu', async () => {
    const error = await fetchWeek(requestOf(response({ status: 500 })), params).catch((e) => e);

    expect(error).toBeInstanceOf(ScheduleError);
    expect(error.message).not.toContain('123');
  });

  it('rejette une réponse qui n’est pas un tableau', async () => {
    const request = requestOf(response({ json: async () => ({ a: 1 }) }));

    await expect(fetchWeek(request, params)).rejects.toBeInstanceOf(ScheduleError);
  });
});

describe('fetchWeekWithRetry', () => {
  it('se reconnecte puis réessaie une seule fois', async () => {
    const expired = requestOf(response({ status: 401 }));
    const fresh = requestOf(response({ json: async () => [{ id: 1 }] }));
    const onExpired = vi.fn().mockResolvedValue(fresh);

    expect(await fetchWeekWithRetry(expired, params, onExpired)).toEqual([{ id: 1 }]);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(fresh.get).toHaveBeenCalledTimes(1);
  });

  it('abandonne si la session est encore expirée au second essai', async () => {
    const fresh = requestOf(response({ status: 401 }));
    const onExpired = vi.fn().mockResolvedValue(fresh);

    await expect(
      fetchWeekWithRetry(requestOf(response({ status: 401 })), params, onExpired),
    ).rejects.toBeInstanceOf(SessionExpiredError);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(fresh.get).toHaveBeenCalledTimes(1);
  });

  it('ne se reconnecte pas pour une autre erreur', async () => {
    const onExpired = vi.fn();

    await expect(
      fetchWeekWithRetry(requestOf(response({ status: 500 })), params, onExpired),
    ).rejects.toBeInstanceOf(ScheduleError);
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe('mapSeance', () => {
  it("mappe une séance de l'API ENT (décalage horaire court +02)", () => {
    const seance = mapSeance(
      {
        code: '1234567',
        title: 'Maths',
        start: '2026-10-05T08:30:00+02',
        end: '2026-10-05T10:00:00+02',
        matiere: 'Algèbre',
        nomModule: 'Mathématiques',
        salles: [{ nomSalle: 'A101' }, { nomSalle: ' ' }, { nomSalle: 'B202' }],
        intervenants: null,
      },
      '123',
    );

    expect(seance).toMatchObject({
      code: '1234567',
      codePersonne: '123',
      titre: 'Maths',
      matiere: 'Algèbre',
      module: 'Mathématiques',
      salles: ['A101', 'B202'],
      intervenants: [],
      groupes: [],
    });
    expect(seance.debut.toISOString()).toBe('2026-10-05T06:30:00.000Z');
    expect(seance.fin.toISOString()).toBe('2026-10-05T08:00:00.000Z');
  });

  it('accepte un décalage complet et des champs optionnels absents', () => {
    const seance = mapSeance(
      { code: '1', start: '2026-12-01T09:00:00+01:00', end: '2026-12-01T10:00:00+01:00' },
      '123',
    );

    expect(seance).toMatchObject({
      titre: null,
      matiere: null,
      module: null,
      theme: null,
      url: null,
      allDay: false,
      nightly: false,
      salles: [],
      intervenants: [],
      groupes: [],
    });
    expect(seance.debut.toISOString()).toBe('2026-12-01T08:00:00.000Z');
  });

  it('mappe intervenants et groupes, dédoublonne, ignore les sans-clé et exclut les e-mails', () => {
    const seance = mapSeance(
      {
        code: '9',
        start: '2026-10-05T08:30:00+02',
        end: '2026-10-05T10:00:00+02',
        theme: '',
        url: '',
        allDay: true,
        salles: [{ nomSalle: 'A1' }, { nomSalle: 'A1' }, {}],
        intervenants: [
          { code: 'i1', nom: 'N', prenom: 'P', sousTitre: '', adresseMail: 'x@y.z', profils: [] },
          { code: 'i1', nom: 'Autre' },
          { nom: 'sans code' },
        ],
        participants: [
          { codeGroupe: 'g1', libelleGroupe: 'G1', codeSession: 's1' },
          { codeGroupe: 'g1', libelleGroupe: 'doublon' },
          { libelleGroupe: 'sans clé' },
        ],
      },
      '123',
    );

    expect(seance.salles).toEqual(['A1']);
    expect(seance.intervenants).toEqual([{ code: 'i1', nom: 'N', prenom: 'P', sousTitre: null }]);
    expect(seance.groupes).toEqual([{ code: 'g1', libelle: 'G1', codeSession: 's1' }]);
    expect(seance).toMatchObject({ theme: null, url: null, allDay: true });
    expect(JSON.stringify(seance)).not.toContain('x@y.z');
    expect(seance).not.toHaveProperty('raw');
  });

  it('liste les clés trouvées (sans valeurs) quand des champs manquent', () => {
    let error;
    try {
      mapSeance({ identifiant: 'secret-value', debutSeance: 'x' }, '123');
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(ScheduleError);
    expect(error.message).toContain('code, start, end');
    expect(error.message).toContain('debutSeance, identifiant');
    expect(error.message).not.toContain('secret-value');
  });

  it('rejette des dates invalides', () => {
    expect(() => mapSeance({ code: '1', start: 'nope', end: 'nope' }, '123')).toThrow(
      /pas des dates/,
    );
  });
});

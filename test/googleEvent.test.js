import { describe, expect, it } from 'vitest';
import { diffEvents, eventId, toEvent } from '../src/google/event.js';
import { parisMidnight, weekBounds } from '../src/schedule/weeks.js';

const seance = (override = {}) => ({
  code: 'abc123',
  titre: 'Titre',
  matiere: 'Algo',
  module: 'M1',
  theme: 'Tri',
  debut: new Date('2026-10-05T06:30:00Z'),
  fin: new Date('2026-10-05T10:00:00Z'),
  allDay: false,
  salles: ['A1', 'B2'],
  intervenants: [{ code: 'i1', nom: 'DUPONT', prenom: 'Jean' }],
  groupes: [{ code: 'g1', libelle: 'Groupe 1' }],
  ...override,
});

describe('eventId', () => {
  it('préfixe un code déjà valide', () => {
    expect(eventId('abc123')).toBe('cesiabc123');
  });

  it.each(['ABC-12', 'séance_1', 'a b'])('encode en base32hex le code %s', (code) => {
    const id = eventId(code);
    expect(id).toMatch(/^cesi[a-v0-9]+$/);
    expect(eventId(code)).toBe(id);
  });

  it('encode selon base32hex (octets 66 2d 6f -> "commu")', () => {
    expect(eventId('f-o')).toBe('cesicommu');
  });

  it('distingue deux codes différents', () => {
    expect(eventId('FOO')).not.toBe(eventId('foo'));
  });
});

describe('toEvent', () => {
  it('construit un événement complet', () => {
    expect(toEvent(seance())).toEqual({
      id: 'cesiabc123',
      status: 'confirmed',
      summary: 'Tri',
      location: 'A1, B2',
      description: 'Module : M1\nThème : Algo\nIntervenant(s) : DUPONT Jean\nGroupe(s) : Groupe 1',
      start: { dateTime: '2026-10-05T06:30:00.000Z', timeZone: 'Europe/Paris' },
      end: { dateTime: '2026-10-05T10:00:00.000Z', timeZone: 'Europe/Paris' },
      extendedProperties: { private: { source: 'cesibridge', code: 'abc123' } },
    });
  });

  it('retombe sur la matière, le titre puis un libellé par défaut', () => {
    expect(toEvent(seance({ theme: null })).summary).toBe('Algo');
    expect(toEvent(seance({ theme: null, matiere: null })).summary).toBe('Titre');
    expect(toEvent(seance({ theme: null, matiere: null, titre: null })).summary).toBe('Cours CESI');
  });

  it('ne répète pas la matière quand elle sert de titre', () => {
    expect(toEvent(seance({ theme: null })).description).not.toContain('Thème');
  });

  it('omet les lignes vides de la description', () => {
    expect(
      toEvent(seance({ module: null, theme: null, intervenants: [], groupes: [] })).description,
    ).toBe('');
    expect(toEvent(seance({ theme: null, intervenants: [], groupes: [] })).description).toBe(
      'Module : M1',
    );
  });

  it('gère un événement sur la journée en date de Paris', () => {
    const event = toEvent(
      seance({
        allDay: true,
        debut: new Date('2026-10-04T22:00:00Z'),
        fin: new Date('2026-10-05T21:59:00Z'),
      }),
    );
    expect(event.start).toEqual({ date: '2026-10-05' });
    expect(event.end).toEqual({ date: '2026-10-06' });
  });
});

describe('diffEvents', () => {
  const a = toEvent(seance());
  const b = toEvent(seance({ code: 'def456' }));

  it('crée, met à jour et supprime', () => {
    const changed = { ...a, location: 'Z9' };
    const result = diffEvents([changed, b], [a, { ...a, id: 'cesiold' }]);
    expect(result.toCreate.map((e) => e.id)).toEqual([b.id]);
    expect(result.toUpdate.map((e) => e.id)).toEqual([a.id]);
    expect(result.toDelete).toEqual(['cesiold']);
  });

  it('ignore un événement inchangé malgré le format renvoyé par Google', () => {
    const fromGoogle = {
      ...a,
      start: { dateTime: '2026-10-05T08:30:00+02:00', timeZone: 'Europe/Paris' },
      end: { dateTime: '2026-10-05T12:00:00+02:00', timeZone: 'Europe/Paris' },
      etag: '"x"',
      reminders: { useDefault: true },
    };
    expect(diffEvents([a], [fromGoogle])).toEqual({ toCreate: [], toUpdate: [], toDelete: [] });
  });

  it('ne supprime jamais un événement non créé par cesibridge', () => {
    const personal = { id: 'perso123', summary: 'Dentiste' };
    const foreign = { id: 'autre123', extendedProperties: { private: { source: 'autre' } } };
    expect(diffEvents([], [personal, foreign]).toDelete).toEqual([]);
  });

  it('ne supprime pas un événement d’examen par défaut', () => {
    const exam = {
      id: 'cesiepreuve1',
      extendedProperties: { private: { source: 'cesibridge-exam' } },
    };
    expect(diffEvents([], [exam]).toDelete).toEqual([]);
    expect(diffEvents([], [exam], { source: 'cesibridge-exam' }).toDelete).toEqual([
      'cesiepreuve1',
    ]);
  });

  it('traite un lieu absent comme un lieu vide', () => {
    const noLocation = toEvent(seance({ salles: [] }));
    const fromGoogle = { ...noLocation };
    delete fromGoogle.location;
    expect(diffEvents([noLocation], [fromGoogle]).toUpdate).toEqual([]);
  });
});

describe('bornes de semaine', () => {
  it('minuit de Paris, été et hiver', () => {
    expect(parisMidnight('2026-10-05').toISOString()).toBe('2026-10-04T22:00:00.000Z');
    expect(parisMidnight('2026-12-07').toISOString()).toBe('2026-12-06T23:00:00.000Z');
  });

  it('minuit de Paris après le passage à l’heure d’hiver', () => {
    const { from, to } = weekBounds({ start: '2026-10-26', end: '2026-11-01' });
    expect(from.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-01T23:00:00.000Z');
  });
});

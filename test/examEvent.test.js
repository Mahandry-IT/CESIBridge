import { describe, expect, it } from 'vitest';
import { diffEvents, toEvent } from '../src/google/event.js';
import { examEventId, toExamEvent } from '../src/exams/event.js';

const exam = (override = {}) => ({
  id: 'ex-2026-1',
  filiere: 'info',
  niveau: 'A3',
  annee: '2026-2027',
  element: 'Algorithmique - Recherche opérationnelle (CCTL)',
  bloc: '[A3 FISE info] Algorithmique',
  format: 'Test',
  plateforme: 'Global Exam',
  session: 'Initiale',
  date: '2026-11-05',
  debut: '08:45',
  fin: '09:40',
  aVerifier: [],
  ...override,
});

describe('examEventId', () => {
  it('est valide pour Google et stable', () => {
    const id = examEventId(exam({ id: 'Éx/ 1 é' }));
    expect(id).toMatch(/^cesiepreuve[a-v0-9]+$/);
    // Google refuse tout caractère hors base32hex, préfixe compris.
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(id.length).toBeGreaterThanOrEqual(5);
    expect(examEventId(exam({ id: 'Éx/ 1 é' }))).toBe(id);
    expect(examEventId(exam({ id: 'autre' }))).not.toBe(id);
  });
});

describe('toExamEvent', () => {
  it('construit un événement horodaté complet', () => {
    expect(toExamEvent(exam(), { imageUrl: 'https://x.test/cal.png' })).toEqual({
      id: examEventId(exam()),
      status: 'confirmed',
      summary: 'Algorithmique - Recherche opérationnelle (CCTL)',
      description:
        "Bloc : [A3 FISE info] Algorithmique\nFormat : Test\nSession : Initiale\nPlateforme : Global Exam\nCalendrier d'origine : https://x.test/cal.png",
      start: { dateTime: '2026-11-05T07:45:00.000Z', timeZone: 'Europe/Paris' },
      end: { dateTime: '2026-11-05T08:40:00.000Z', timeZone: 'Europe/Paris' },
      extendedProperties: { private: { source: 'cesibridge-exam', code: 'ex-2026-1' } },
    });
  });

  it('gère l’heure d’été', () => {
    const event = toExamEvent(exam({ date: '2026-06-10' }));
    expect(event.start.dateTime).toBe('2026-06-10T06:45:00.000Z');
  });

  it('préfixe les rattrapages, sans tenir compte de la casse', () => {
    expect(toExamEvent(exam({ session: 'RATTRAPAGE' })).summary).toBe(
      '[Rattrapage] Algorithmique - Recherche opérationnelle (CCTL)',
    );
  });

  it('passe sur la journée sans horaires', () => {
    const event = toExamEvent(exam({ debut: null, fin: null }));
    expect(event.start).toEqual({ date: '2026-11-05' });
    expect(event.end).toEqual({ date: '2026-11-06' });
  });

  it('passe sur la journée si l’horaire est à vérifier et signale le doute', () => {
    const event = toExamEvent(exam({ aVerifier: ['horaire'] }));
    expect(event.start).toEqual({ date: '2026-11-05' });
    expect(event.summary.startsWith('⚠ ')).toBe(true);
    expect(event.description).toContain('À vérifier (lecture automatique) : horaire');
  });

  it('garde les horaires quand seule la date est à vérifier', () => {
    const event = toExamEvent(exam({ session: 'Rattrapage', aVerifier: ['date', 'horaire'] }));
    expect(event.summary).toBe('⚠ [Rattrapage] Algorithmique - Recherche opérationnelle (CCTL)');
    expect(event.description).toContain('À vérifier (lecture automatique) : date, horaire');
    const dateOnly = toExamEvent(exam({ aVerifier: ['date'] }));
    expect(dateOnly.start.dateTime).toBe('2026-11-05T07:45:00.000Z');
    expect(dateOnly.description).toContain('À vérifier (lecture automatique) : date');
  });

  it('omet les lignes vides de la description', () => {
    expect(
      toExamEvent(exam({ bloc: null, format: null, plateforme: null, session: null })).description,
    ).toBe('');
  });

  it('ne pose aucun rappel : ils sont envoyés par e-mail', () => {
    expect(toExamEvent(exam())).not.toHaveProperty('reminders');
  });
});

describe('diffEvents pour les examens', () => {
  const options = { source: 'cesibridge-exam' };
  const a = toExamEvent(exam());

  it('ignore les rappels et le format de date renvoyés par Google', () => {
    const fromGoogle = {
      ...a,
      start: { dateTime: '2026-11-05T08:45:00+01:00', timeZone: 'Europe/Paris' },
      end: { dateTime: '2026-11-05T09:40:00+01:00', timeZone: 'Europe/Paris' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }] },
    };
    expect(diffEvents([a], [fromGoogle], options)).toEqual({
      toCreate: [],
      toUpdate: [],
      toDelete: [],
    });
  });

  it('met à jour quand un champ géré change', () => {
    const changed = toExamEvent(exam({ element: 'Autre' }));
    expect(diffEvents([changed], [a], options).toUpdate.map((e) => e.id)).toEqual([a.id]);
  });

  it('supprime un examen disparu', () => {
    expect(diffEvents([], [a], options).toDelete).toEqual([a.id]);
  });

  it('non-régression croisée : les flux ne se suppriment jamais entre eux', () => {
    const course = toEvent({
      code: 'abc123',
      titre: 'T',
      matiere: 'M',
      module: null,
      theme: null,
      debut: new Date('2026-10-05T06:30:00Z'),
      fin: new Date('2026-10-05T10:00:00Z'),
      allDay: false,
      salles: [],
      intervenants: [],
      groupes: [],
    });
    expect(diffEvents([], [a]).toDelete).toEqual([]);
    expect(diffEvents([], [course], options).toDelete).toEqual([]);
  });
});

describe('lien du cours', () => {
  const url = 'https://moodle.cesi.fr/course/view.php?id=1';

  it('ajoute le cours rattaché avant le calendrier d’origine', () => {
    const lines = toExamEvent(exam({ coursUrl: url }), { imageUrl: 'https://x' }).description.split(
      '\n',
    );
    expect(lines.at(-2)).toBe(`Cours : ${url}`);
  });

  it('ne met aucune ligne sans cours rattaché', () => {
    expect(toExamEvent(exam({ coursUrl: null })).description).not.toContain('Cours :');
  });
});

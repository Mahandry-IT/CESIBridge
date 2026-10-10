import { describe, expect, it } from 'vitest';
import { MoodleError } from '../src/moodle/errors.js';
import { selectExamCalendarActivity, selectSessionCourse } from '../src/moodle/examCalendar.js';

const course = (id, name, category = 'Ma session') => ({ id, name, category });
const ID = { niveau: 'A3', annee: '2026-2027' };

describe('selectSessionCourse', () => {
  it('un seul cours « Ma session » (casse, accents et espaces ignorés)', () => {
    const courses = [
      course(1, 'Algo', 'Informatique'),
      course(2, 'FISE INFO A3', '  MA  SESSION '),
    ];

    expect(selectSessionCourse(courses, ID).id).toBe(2);
  });

  it('plusieurs cours : départage par niveau (mot entier) et année', () => {
    const courses = [
      course(1, 'FISE INFO A2 Nancy 2026-2027'),
      course(2, 'FISE INFO A3 Nancy 2025-2026'),
      course(3, 'FISE INFO A3 Nancy 2026-2027'),
      course(4, 'FISE INFO A33 Nancy 2026-2027'),
    ];

    expect(selectSessionCourse(courses, ID).id).toBe(3);
  });

  it.each(['A3 Nancy 2026 2027', 'A3 Nancy 26-27', 'A3 Nancy 2026/2027'])(
    'tolère le format d’année de « %s »',
    (suffix) => {
      const courses = [course(1, 'FISE A2 2026-2027'), course(2, `FISE INFO ${suffix}`)];

      expect(selectSessionCourse(courses, ID).id).toBe(2);
    },
  );

  it('aucun cours « Ma session » : MoodleError', () => {
    expect(() => selectSessionCourse([course(1, 'Algo', 'Informatique')], ID)).toThrow(MoodleError);
  });

  it('aucun ne correspond : erreur listant les candidats', () => {
    const courses = [course(1, 'FISE A1 2026-2027'), course(2, 'FISE A2 2026-2027')];

    expect(() => selectSessionCourse(courses, ID)).toThrow(/A1.*A2/);
  });

  it('plusieurs correspondent : erreur ambiguë listant les candidats', () => {
    const courses = [course(1, 'FISE A3 Nancy 2026-2027'), course(2, 'FISE A3 Metz 2026-2027')];

    expect(() => selectSessionCourse(courses, ID)).toThrow(/ambigus.*Nancy.*Metz/);
  });
});

describe('selectExamCalendarActivity', () => {
  const calendar = {
    id: 9,
    name: 'Calendrier des examens',
    type: 'resource',
    url: 'https://moodle.cesi.fr/mod/resource/view.php?id=9',
  };

  it('préfère la section Généralités', () => {
    const other = { ...calendar, id: 8, url: 'https://moodle.cesi.fr/mod/resource/view.php?id=8' };
    const sections = [
      { name: 'Bloc 1', activities: [other] },
      { name: 'GÉNÉRALITÉS', activities: [calendar] },
    ];

    expect(selectExamCalendarActivity(sections)).toBe(calendar);
  });

  it('section absente : cherche dans toutes les sections, sans tenir compte des accents', () => {
    const accentless = { ...calendar, name: 'CALENDRIER DES EXAMENS 2026' };
    const sections = [{ name: 'Bloc 1', activities: [{ id: 1, name: 'Quiz', type: 'quiz' }] }];
    sections.push({ name: 'Autre', activities: [accentless] });

    expect(selectExamCalendarActivity(sections)).toBe(accentless);
  });

  it('ignore les activités qui ne sont pas des ressources', () => {
    const sections = [{ name: 'Généralités', activities: [{ ...calendar, type: 'page' }] }];

    expect(() => selectExamCalendarActivity(sections)).toThrow(MoodleError);
  });

  it('activité absente ou sans lien : MoodleError', () => {
    expect(() => selectExamCalendarActivity([{ name: 'Généralités', activities: [] }])).toThrow(
      /introuvable/,
    );
    expect(() =>
      selectExamCalendarActivity([
        { name: 'Généralités', activities: [{ ...calendar, url: null }] },
      ]),
    ).toThrow(/sans lien/);
  });
});

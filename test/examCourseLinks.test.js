import { describe, expect, it } from 'vitest';
import { courseUrlFor, linkCourses } from '../src/exams/courseLinks.js';

const scope = { niveau: 'A3', annee: '2026-2027' };
const course = (id, name) => ({ name, url: `https://moodle.cesi.fr/course/view.php?id=${id}` });
const courses = [
  course(1, 'FISE INFO A3 Algorithmique et optimisation combinatoire 2026-2027'),
  course(2, 'FISE INFO A3 Big data 2026-2027'),
  course(3, 'FISE INFO A4 (Adm parallèles) Big Data 2026 2027'),
  course(4, 'FISE INFO A3 I.A (machine learning) 2026-2027'),
  course(5, 'FISE INFO A3 S.I et sécurité 2026-2027'),
  course(6, "FISE INFO A3 Sciences fondamentales de l'ingénieur (SFI) 2026-2027"),
  course(7, 'A3 ANGLAIS 2026-2027'),
  course(8, 'A4 ANGLAIS 2026-2027'),
  course(9, 'FISE INFO A3 Génie logiciel 2026-2027'),
  course(10, 'FISE INFO A3 Nancy 2026-2027'),
];
const idOf = (bloc, list = courses) => courseUrlFor(bloc, list, scope)?.split('=')[1] ?? null;

describe('courseUrlFor', () => {
  it.each([
    ['[A3 FISE info] Algorithmique', '1'],
    ['[A3 FISE info] Big data', '2'],
    ['[A3 FISE info] I.A.', '4'],
    ['[A3 FISE info] S.I. et sécurité', '5'],
    ["[A3 FISE info] Sciences fondamentales de l'ingénieur", '6'],
    ['[A3 FISE] Anglais', '7'],
    ['[A3 info] Génie logiciel', '9'],
  ])('rattache %s à son cours', (bloc, id) => {
    expect(idOf(bloc)).toBe(id);
  });

  it.each([['Test plateforme'], [null], [''], ['[A3 FISE info]']])(
    'ne met aucun lien pour %s',
    (bloc) => {
      expect(idOf(bloc)).toBeNull();
    },
  );

  it('ne met aucun lien quand plusieurs cours correspondent', () => {
    const twice = [...courses, course(11, 'FISE INFO A3 Big data (groupe B) 2026-2027')];
    expect(idOf('[A3 FISE info] Big data', twice)).toBeNull();
  });

  it("ignore les cours d'une autre année ou sans lien", () => {
    expect(idOf('[A3 FISE] Anglais', [course(1, 'A3 ANGLAIS 2025-2026')])).toBeNull();
    expect(idOf('[A3 FISE] Anglais', [course(1, 'A3 ANGLAIS 26-27')])).toBe('1');
    expect(idOf('[A3 FISE] Anglais', [{ name: 'A3 ANGLAIS 2026-2027', url: null }])).toBeNull();
  });
});

describe('linkCourses', () => {
  it('complète chaque examen sans le modifier', () => {
    const exams = [
      { id: 'a', bloc: '[A3 FISE] Anglais' },
      { id: 'b', bloc: null },
    ];
    expect(linkCourses(exams, courses, scope)).toEqual([
      { id: 'a', bloc: '[A3 FISE] Anglais', coursUrl: courses[6].url },
      { id: 'b', bloc: null, coursUrl: null },
    ]);
    expect(exams[0]).not.toHaveProperty('coursUrl');
  });
});

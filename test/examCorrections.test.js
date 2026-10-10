import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyCorrections, loadCorrections, parseCorrections } from '../src/exams/corrections.js';
import { ExamError } from '../src/exams/errors.js';
import { examId } from '../src/exams/parse.js';

const scope = { filiere: 'FISE Informatique', niveau: 'A3', annee: '2026-2027' };
const exam = (element, session, extra = {}) => ({
  id: examId(scope, element, session),
  ...scope,
  element,
  bloc: 'Bloc',
  format: 'Test',
  plateforme: null,
  session,
  date: '2026-11-05',
  debut: '08:45',
  fin: '09:40',
  aVerifier: [],
  ...extra,
});
const exams = () => [
  exam('S.I. - Sécurité du S.I. (Etude de cas)', 'Initiale', { date: '2026-11-26' }),
  exam('S.I. - Sécurité du S.I. (Etude de cas)', 'Rattrapage', { date: '2027-01-21' }),
  exam('Génie logiciel (Etude de cas)', 'Initiale', {
    date: '2027-05-13',
    debut: null,
    fin: null,
    aVerifier: ['date', 'horaire'],
  }),
];
const apply = (entries, list = exams()) => applyCorrections(list, entries, scope);

describe('applyCorrections', () => {
  it('sans correction : mêmes examens, triés par date puis heure de début', () => {
    const shuffled = [
      exam('C', null, { date: '2026-12-01', debut: '10:00' }),
      exam('B', null, { date: '2026-12-01', debut: '08:00' }),
      exam('A', null, { date: '2026-12-01', debut: null, fin: null }),
      exam('D', null, { date: '2026-11-01' }),
    ];
    const { exams: sorted, unmatched } = apply([], shuffled);
    expect(sorted.map((item) => item.element)).toEqual(['D', 'A', 'B', 'C']);
    expect(unmatched).toEqual([]);
  });

  it('set : corrige les heures et retire le drapeau horaire seulement', () => {
    const { exams: result } = apply([
      {
        match: { element: 'Génie logiciel (Etude de cas)', session: 'Initiale' },
        set: { debut: '09:45', fin: '11:45' },
      },
    ]);
    expect(result[2]).toMatchObject({ debut: '09:45', fin: '11:45', aVerifier: ['date'] });
  });

  it('set : corrige la date, retire le drapeau date et retrie', () => {
    const { exams: result } = apply([
      { match: { element: 'Génie logiciel (Etude de cas)' }, set: { date: '2026-10-01' } },
    ]);
    expect(result[0]).toMatchObject({
      element: 'Génie logiciel (Etude de cas)',
      date: '2026-10-01',
      aVerifier: ['horaire'],
    });
  });

  it('match tolérant : casse, accents, ponctuation et confusions de lecture', () => {
    const { exams: result, unmatched } = apply([
      {
        match: { element: 's.l. – securite du S.1. (étude de cas)', session: 'rattrapage' },
        set: { plateforme: 'Théia' },
      },
    ]);
    expect(unmatched).toEqual([]);
    expect(result.map((item) => item.plateforme)).toEqual([null, 'Théia', null]);
  });

  it('match sans session : vise toutes les sessions de l’élément', () => {
    const { exams: result } = apply([
      { match: { element: 'S.I. - Sécurité du S.I. (Etude de cas)' }, set: { format: 'Oral' } },
    ]);
    expect(result.map((item) => item.format)).toEqual(['Oral', 'Oral', 'Test']);
  });

  it('set sur le libellé : recalcule l’identifiant', () => {
    const { exams: result } = apply([
      {
        match: { element: 'Génie logiciel (Etude de cas)' },
        set: { element: 'Génie logiciel - Génie logiciel (Etude de cas)' },
      },
    ]);
    expect(result[2].id).toBe(
      examId(scope, 'Génie logiciel - Génie logiciel (Etude de cas)', 'Initiale'),
    );
  });

  it('add : ajoute un examen complet, identifié comme ceux de la lecture', () => {
    const { exams: result } = apply([
      {
        add: { element: 'Soutenance de projet', date: '2026-12-18', debut: '14:00', fin: '15:00' },
      },
    ]);
    expect(result).toHaveLength(4);
    expect(result[1]).toEqual({
      id: examId(scope, 'Soutenance de projet', null),
      ...scope,
      element: 'Soutenance de projet',
      bloc: null,
      format: null,
      plateforme: null,
      session: null,
      date: '2026-12-18',
      debut: '14:00',
      fin: '15:00',
      aVerifier: [],
    });
  });

  it('add d’un examen déjà présent : identifiant suffixé, pas de collision', () => {
    const { exams: result } = apply([
      {
        add: {
          element: 'Génie logiciel (Etude de cas)',
          session: 'Initiale',
          date: '2027-06-17',
        },
      },
    ]);
    expect(new Set(result.map((item) => item.id)).size).toBe(4);
    expect(result[3].id).toBe(`${examId(scope, 'Génie logiciel (Etude de cas)', 'Initiale')}-2`);
  });

  it('remove : supprime les examens visés', () => {
    const { exams: result } = apply([
      {
        match: { element: 'S.I. - Sécurité du S.I. (Etude de cas)', session: 'Initiale' },
        remove: true,
      },
    ]);
    expect(result.map((item) => item.session)).toEqual(['Rattrapage', 'Initiale']);
  });

  it('renvoie dans unmatched les match sans correspondance', () => {
    const missing = { element: 'Épreuve disparue', session: 'Initiale' };
    const { exams: result, unmatched } = apply([
      { match: missing, set: { date: '2026-10-01' } },
      { match: { element: 'Génie logiciel (Etude de cas)', session: 'Rattrapage' }, remove: true },
    ]);
    expect(result).toHaveLength(3);
    expect(unmatched).toEqual([
      missing,
      { element: 'Génie logiciel (Etude de cas)', session: 'Rattrapage' },
    ]);
  });

  it('ne modifie pas les examens reçus', () => {
    const list = exams();
    const before = structuredClone(list);
    apply(
      [{ match: { element: 'Génie logiciel (Etude de cas)' }, set: { date: '2026-10-01' } }],
      list,
    );
    expect(list).toEqual(before);
  });
});

describe('parseCorrections', () => {
  const invalid = (source) => {
    try {
      parseCorrections(source);
    } catch (error) {
      return error;
    }
    throw new Error('aucune erreur levée');
  };

  it('accepte un fichier vide, avec ou sans BOM', () => {
    expect(parseCorrections('')).toEqual([]);
    expect(parseCorrections('\uFEFF[]')).toEqual([]);
  });

  it('valide et nettoie les trois formes d’entrée', () => {
    const entries = parseCorrections(
      JSON.stringify([
        { match: { element: ' A ', session: 'Initiale' }, set: { debut: '09:00', fin: null } },
        { add: { element: 'B', date: '2026-12-18' } },
        { match: { element: 'C' }, remove: true },
      ]),
    );
    expect(entries[0].match).toEqual({ element: 'A', session: 'Initiale' });
    expect(entries[0].set).toEqual({ debut: '09:00', fin: null });
    expect(entries[1].add).toEqual({ element: 'B', date: '2026-12-18' });
    expect(entries[2]).toEqual({ match: { element: 'C' }, remove: true });
  });

  it('JSON mal formé : erreur claire qui ne recopie pas le contenu', () => {
    const error = invalid('[{ "match": secret-token ]');
    expect(error).toBeInstanceOf(ExamError);
    expect(error.message).toBe('fichier de corrections invalide : JSON mal formé');
  });

  it('schéma invalide : désigne l’entrée et le champ, sans la valeur', () => {
    const error = invalid(
      JSON.stringify([
        { match: { element: 'A' }, set: { date: '18/12/2026-SECRET' } },
        { add: { element: 'B' } },
        { match: { element: 'C' }, set: { debut: '9h00', motdepasse: 'SECRET' } },
      ]),
    );
    expect(error).toBeInstanceOf(ExamError);
    expect(error.message).toContain('[0.set.date] : date AAAA-MM-JJ existante attendue');
    expect(error.message).toContain('[1.add.date]');
    expect(error.message).toContain('[2.set.debut] : heure HH:MM attendue');
    expect(error.message).toContain('[2.set] : clé non reconnue');
    expect(error.message).not.toMatch(/SECRET|motdepasse|18\/12/);
  });

  it('refuse un set vide, un remove à false, un jour inexistant, un document sans tableau', () => {
    const entry = (extra) => JSON.stringify([{ match: { element: 'A' }, ...extra }]);
    expect(invalid(entry({ set: {} })).message).toContain('[0.set] : au moins un champ attendu');
    expect(invalid(entry({ remove: false })).message).toContain('[0.remove]');
    expect(invalid(entry({})).message).toContain('[0.set]');
    expect(invalid('[{"add":{"element":"A","date":"2027-02-30"}}]').message).toContain(
      '[0.add.date] : date AAAA-MM-JJ existante attendue',
    );
    expect(invalid('{"add":{}}').message).toContain('un tableau d’entrées est attendu');
    expect(invalid('[null]').message).toContain('[0]');
  });

  it('limite le nombre d’erreurs détaillées', () => {
    const many = JSON.stringify(Array.from({ length: 8 }, () => ({ add: {} })));
    expect(invalid(many).message).toContain('autre(s)');
  });
});

describe('loadCorrections', () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cesibridge-exam-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('fichier absent : aucune correction', async () => {
    expect(await loadCorrections(join(dir, 'absent.json'))).toEqual({ entries: [], text: '' });
  });

  it('renvoie les entrées validées et le texte exact du fichier', async () => {
    const path = join(dir, 'corrections.json');
    const text = '[\n  { "match": { "element": "A" }, "remove": true }\n]\n';
    await writeFile(path, text);
    expect(await loadCorrections(path)).toEqual({
      entries: [{ match: { element: 'A' }, remove: true }],
      text,
    });
  });

  it('JSON invalide : ExamError', async () => {
    const path = join(dir, 'corrections.json');
    await writeFile(path, '{ pas du json');
    await expect(loadCorrections(path)).rejects.toThrow(ExamError);
  });

  it('chemin illisible (dossier) : ExamError sans le chemin', async () => {
    await expect(loadCorrections(dir)).rejects.toThrow(/^fichier de corrections illisible/);
  });
});

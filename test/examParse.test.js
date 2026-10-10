import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimId, examId, matchKey, parseExams } from '../src/exams/parse.js';

// Lignes réellement lues sur le calendrier 2026-2027 (32 examens, tous de la même formation).
const rows = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'exam-rows.json'), 'utf8'),
);
const scope = { filiere: 'FISE Informatique', niveau: 'A3', annee: '2026-2027' };

const row = (extra = {}) => ({
  formation: 'FISE Informatique A3',
  element: 'Algorithmique - Recherche opérationnelle (CCTL)',
  bloc: '[A3 FISE info] Algorithmique',
  format: 'Test',
  plateforme: '',
  session: 'Initiale',
  date: '05/11/2026',
  debut: '10h00',
  fin: '11h40',
  flags: [],
  ...extra,
});
const parseOne = (extra) => parseExams([row(extra)], scope)[0];

describe('parseExams — calendrier réel', () => {
  const exams = parseExams(rows, scope);

  it('garde les 32 examens dans l’ordre du tableau, sans rien signaler', () => {
    expect(exams).toHaveLength(32);
    expect(exams.map((exam) => exam.date)).toEqual(
      rows.map(({ date }) => date.split('/').reverse().join('-')),
    );
    expect(exams.every((exam) => exam.aVerifier.length === 0)).toBe(true);
  });

  it('produit des identifiants uniques, stables et déterministes', () => {
    const ids = exams.map((exam) => exam.id);
    expect(new Set(ids).size).toBe(32);
    expect(ids.every((id) => /^[0-9a-f]{20}$/.test(id))).toBe(true);
    expect(parseExams(rows, scope).map((exam) => exam.id)).toEqual(ids);
    // Valeur figée : changer le calcul de l'id dupliquerait tous les événements déjà publiés.
    expect(ids[0]).toBe('5306aa721c737e4606be');
  });

  it('donne la forme complète d’un examen', () => {
    expect(exams[2]).toEqual({
      id: examId(scope, 'Sciences fondamentales - Sciences du numérique (CCTL)', 'Initiale'),
      ...scope,
      element: 'Sciences fondamentales - Sciences du numérique (CCTL)',
      bloc: "[A3 FISE info] Sciences fondamentales de l'ingénieur",
      format: 'Test',
      plateforme: null,
      session: 'Initiale',
      date: '2026-11-05',
      debut: '08:45',
      fin: '09:40',
      aVerifier: [],
    });
  });

  it('place les TOEIC sur la journée, sans drapeau', () => {
    const toeic = exams.filter((exam) => exam.element.includes('TOEIC'));
    expect(toeic.map((exam) => exam.date)).toEqual(['2026-09-14', '2026-12-14', '2027-05-31']);
    for (const exam of toeic) {
      expect(exam).toMatchObject({ debut: null, fin: null, session: null, aVerifier: [] });
      expect(exam.plateforme).toBe('Global Exam');
    }
  });
});

describe('parseExams — identifiants', () => {
  it('ne dépend pas de la date : un report garde le même id', () => {
    expect(parseOne({ date: '12/11/2026' }).id).toBe(parseOne().id);
    expect(parseOne({ debut: '14h00', fin: '15h00' }).id).toBe(parseOne().id);
  });

  it('distingue l’élément et la session, pas la casse ni les confusions de lecture', () => {
    expect(parseOne({ session: 'Rattrapage' }).id).not.toBe(parseOne().id);
    expect(parseOne({ element: 'Autre épreuve' }).id).not.toBe(parseOne().id);
    expect(parseOne({ element: 'ALGORITHMIQUE – recherche   operationne1le (CCTL)' }).id).toBe(
      parseOne().id,
    );
  });

  it('suffixe les doublons par leur rang d’occurrence', () => {
    const ids = parseExams([row(), row(), row()], scope).map((exam) => exam.id);
    expect(ids).toEqual([ids[0], `${ids[0]}-2`, `${ids[0]}-3`]);
  });

  it('claimId réserve le premier identifiant libre', () => {
    const taken = new Set(['a', 'a-2']);
    expect(claimId('a', taken)).toBe('a-3');
    expect(claimId('b', taken)).toBe('b');
    expect([...taken]).toEqual(['a', 'a-2', 'a-3', 'b']);
  });
});

describe('parseExams — formation', () => {
  const kept = (formation) => parseExams([row({ formation })], scope).length === 1;

  it('reconnaît la formation malgré casse, accents, espaces et confusions OCR', () => {
    for (const formation of [
      'FISE Informatique A3',
      'fise  informatique a3',
      'FISE Informatique À3',
      'F|SE lnformatique A3',
      'FISEInformatiqueA3',
      'FISE Informatiaue A3',
    ]) {
      expect(kept(formation), formation).toBe(true);
    }
  });

  it('garde une ligne dont la formation est vide, tronquée ou illisible', () => {
    for (const formation of ['', '   ', '-', 'FISE Informatique', 'F!$E Inf@rm A3', undefined]) {
      expect(kept(formation), String(formation)).toBe(true);
    }
  });

  it('écarte une ligne clairement d’une autre formation', () => {
    for (const formation of [
      'FISA Informatique A3',
      'FISE Informatique A4',
      'FISE Généraliste A3',
      'Formation',
    ]) {
      expect(kept(formation), formation).toBe(false);
    }
  });
});

describe('parseExams — libellés', () => {
  it('corrige les sigles I.A. et S.I. mal lus et l’apostrophe typographique', () => {
    expect(parseOne({ element: 'LA. - Généralités sur l’LA. (CCTL)' }).element).toBe(
      "I.A. - Généralités sur l'I.A. (CCTL)",
    );
    expect(parseOne({ element: '|A. - Algorithmes d’apprentissage' }).element).toBe(
      "I.A. - Algorithmes d'apprentissage",
    );
    expect(parseOne({ bloc: '[A3 FISE info] lA.' }).bloc).toBe('[A3 FISE info] I.A.');
    expect(parseOne({ element: "LA. - Généralités sur l'A. (CCTL)" }).element).toBe(
      "I.A. - Généralités sur l'I.A. (CCTL)",
    );
    expect(parseOne({ element: 'S.l. - Sécurité du S.|. (Etude de cas)' }).element).toBe(
      'S.I. - Sécurité du S.I. (Etude de cas)',
    );
    expect(parseOne({ element: 'S.l - Système d’information' }).element).toBe(
      "S.I. - Système d'information",
    );
    expect(parseOne({ bloc: '[A3 FISE info] S.!. et sécurité' }).bloc).toBe(
      '[A3 FISE info] S.I. et sécurité',
    );
  });

  it('ne touche pas un mot qui se termine par « la. »', () => {
    expect(parseOne({ element: 'Voilà. Fin de la.' }).element).toBe('Voilà. Fin de la.');
  });

  it('compacte les espaces et met à null les cellules vides', () => {
    const exam = parseOne({
      element: '  Génie   logiciel ',
      bloc: ' ',
      format: '',
      plateforme: '',
    });
    expect(exam).toMatchObject({
      element: 'Génie logiciel',
      bloc: null,
      format: null,
      plateforme: null,
    });
  });

  it('normalise la session quand elle est proche, sinon la garde', () => {
    expect(parseOne({ session: 'Intiale' }).session).toBe('Initiale');
    expect(parseOne({ session: 'lnitiale' }).session).toBe('Initiale');
    expect(parseOne({ session: 'RATTRAPAGE' }).session).toBe('Rattrapage');
    expect(parseOne({ session: 'Ratrapaqe' }).session).toBe('Rattrapage');
    expect(parseOne({ session: 'Test' }).session).toBe('Test');
    expect(parseOne({ session: '' }).session).toBeNull();
  });

  it('nomme un élément illisible plutôt que de le laisser vide', () => {
    expect(parseOne({ element: '' }).element).toBe('Examen (libellé illisible)');
  });
});

describe('parseExams — dates', () => {
  const dated = (...dates) =>
    parseExams(
      dates.map((date, index) => row({ element: `Épreuve ${index}`, date })),
      scope,
    ).map((exam) => [exam.date, exam.aVerifier]);

  it('remplace une date impossible par celle de la ligne précédente, signalée', () => {
    expect(dated('05/11/2026', '32/13/2026', '41/12/2026', '12/11/2026')).toEqual([
      ['2026-11-05', []],
      ['2026-11-05', ['date']],
      ['2026-11-05', ['date']],
      ['2026-11-12', []],
    ]);
  });

  it('refuse un jour qui n’existe pas au calendrier', () => {
    expect(dated('05/11/2026', '30/02/2027')[1]).toEqual(['2026-11-05', ['date']]);
    expect(dated('05/11/2026', '31/04/2027')[1]).toEqual(['2026-11-05', ['date']]);
  });

  it('refuse une date hors de l’année scolaire (1er sept. → 31 août)', () => {
    expect(dated('01/09/2026', '31/08/2027')).toEqual([
      ['2026-09-01', []],
      ['2027-08-31', []],
    ]);
    expect(dated('05/11/2026', '05/11/2027')[1]).toEqual(['2026-11-05', ['date']]);
    expect(dated('05/11/2026', '31/08/2026')[1]).toEqual(['2026-11-05', ['date']]);
    expect(dated('05/11/2026', '01/09/2027')[1]).toEqual(['2026-11-05', ['date']]);
  });

  it('donne à une première ligne illisible la date valide suivante', () => {
    expect(dated(null, '5/11/26', '12/11/2026')).toEqual([
      ['2026-11-12', ['date']],
      ['2026-11-12', ['date']],
      ['2026-11-12', []],
    ]);
  });

  it('retombe sur la rentrée quand aucune date n’est lisible', () => {
    expect(dated(null, 'abc')).toEqual([
      ['2026-09-01', ['date']],
      ['2026-09-01', ['date']],
    ]);
  });

  it('garde mais signale une date valide qui casse l’ordre croissant', () => {
    expect(dated('12/11/2026', '05/11/2026', '26/11/2026')).toEqual([
      ['2026-11-12', []],
      ['2026-11-05', ['date']],
      ['2026-11-26', []],
    ]);
  });

  it('rejette une année scolaire mal formée', () => {
    expect(() => parseExams(rows, { ...scope, annee: '2026' })).toThrow(RangeError);
  });
});

describe('parseExams — horaires', () => {
  const times = (debut, fin) => {
    const exam = parseOne({ debut, fin });
    return [exam.debut, exam.fin, exam.aVerifier];
  };

  it('convertit HHhMM en HH:MM', () => {
    expect(times('08h45', '09h40')).toEqual(['08:45', '09:40', []]);
    expect(times('8h45', '10h05')).toEqual(['08:45', '10:05', []]);
  });

  it('sans aucune heure : examen sur la journée, sans drapeau', () => {
    expect(times(null, null)).toEqual([null, null, []]);
    expect(times('', '')).toEqual([null, null, []]);
  });

  it('heure impossible (11h65, 24h00) : journée + drapeau horaire', () => {
    expect(times('09h45', '11h65')).toEqual([null, null, ['horaire']]);
    expect(times('24h00', '25h00')).toEqual([null, null, ['horaire']]);
    expect(times('0845', '09h40')).toEqual([null, null, ['horaire']]);
  });

  it('une seule heure, ou une fin avant le début : journée + drapeau horaire', () => {
    expect(times('08h45', null)).toEqual([null, null, ['horaire']]);
    expect(times(null, '09h40')).toEqual([null, null, ['horaire']]);
    expect(times('10h00', '10h00')).toEqual([null, null, ['horaire']]);
    expect(times('11h40', '10h00')).toEqual([null, null, ['horaire']]);
  });
});

describe('parseExams — drapeaux de l’OCR', () => {
  it('les reporte dans aVerifier, dédoublonnés, dans l’ordre date puis horaire', () => {
    expect(parseOne({ flags: ['horaire', 'date', 'horaire'] }).aVerifier).toEqual([
      'date',
      'horaire',
    ]);
    expect(parseOne({ flags: ['horaire'], date: '99/99/2026' }).aVerifier).toEqual([
      'date',
      'horaire',
    ]);
  });

  it('garde les heures lues quand seul le vote était incertain', () => {
    expect(parseOne({ flags: ['horaire'] })).toMatchObject({
      debut: '10:00',
      fin: '11:40',
      aVerifier: ['horaire'],
    });
  });

  it('accepte une ligne sans drapeaux', () => {
    expect(parseOne({ flags: undefined }).aVerifier).toEqual([]);
  });
});

describe('matchKey', () => {
  it('ignore casse, accents, ponctuation et confusions I/l/1 et O/0', () => {
    expect(matchKey(' S.l. – Sécurité  du S.I. (Étude de cas) ')).toBe(
      matchKey('s.i. - securite du s.1. (etude de cas)'),
    );
    expect(matchKey('Bloc 0')).toBe(matchKey('BLOC O'));
    expect(matchKey(null)).toBe('');
  });
});

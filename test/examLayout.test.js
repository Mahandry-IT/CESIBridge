import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyseLayout,
  columnsFromGutters,
  columnsFromRules,
  electReading,
  eraseRules,
  findFullRules,
  findHeaderEnd,
  findTextBands,
  findVerticalRules,
  inkProfiles,
  majority,
  mergeAnchors,
  nearestLine,
  rowMedians,
  rowPitch,
} from '../src/exams/layout.js';
import { parseRawText } from '../src/exams/rawText.js';

const fixture = (name) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

const WHITE = 255;
const STRIPE = 242;
const GRID = 224;
const HEADER = 166;
const INK = 0;
const COLUMN_UNITS = [30, 60, 40, 20, 20, 20, 25, 15, 15];
const ROW_UNITS = 10;
const HEADER_UNITS = 12;
const ROWS = 6;

// Tableau synthétique façon capture Excel, à l'échelle `unit` : cadre noir à gauche, en-tête coloré,
// lignes alternées, quadrillage gris clair (visible sur les lignes blanches) et, dans chaque cellule,
// un pavé d'encre calé à gauche (comme du texte, il laisse le fond majoritaire sur sa rangée).
const INK_SHARE = 0.4;
function drawTable({ unit = 1, grid = true, header = true } = {}) {
  const top = header ? HEADER_UNITS * unit : 0;
  const rowHeight = ROW_UNITS * unit;
  const width = unit + COLUMN_UNITS.reduce((sum, units) => sum + units, 0) * unit;
  const height = top + ROWS * rowHeight;
  const data = new Uint8Array(width * height).fill(WHITE);
  const fill = (x0, x1, y0, y1, level) => {
    for (let y = y0; y < y1; y++) data.fill(level, y * width + x0, y * width + x1);
  };
  fill(0, width, 0, top, HEADER);
  const columns = [];
  const blocks = [];
  let left = unit;
  for (const units of COLUMN_UNITS) {
    columns.push({ left, right: left + units * unit - unit });
    blocks.push({
      left: left + 3 * unit,
      right: left + 3 * unit + Math.round(units * unit * INK_SHARE),
    });
    left += units * unit;
  }
  for (let row = 0; row < ROWS; row++) {
    const y = top + row * rowHeight;
    const striped = row % 2 === 1;
    if (striped) fill(0, width, y, y + rowHeight, STRIPE);
    columns.forEach((column, index) => {
      fill(blocks[index].left, blocks[index].right, y + 3 * unit, y + 7 * unit, INK);
      if (grid && !striped) fill(column.right, column.right + unit, y, y + rowHeight, GRID);
    });
  }
  fill(0, unit, 0, height, INK);
  return { image: { data, width, height }, columns, blocks, top, rowHeight };
}

describe('rowMedians / findHeaderEnd', () => {
  it('donne le fond de chaque rangée, quel que soit le texte', () => {
    const image = {
      data: Uint8Array.from([255, 255, 0, 242, 0, 242, 0, 0, 166]),
      width: 3,
      height: 3,
    };
    expect([...rowMedians(image)]).toEqual([255, 242, 0]);
  });

  const medians = (...runs) =>
    Uint8Array.from(runs.flatMap(([level, count]) => Array(count).fill(level)));

  it('termine l’en-tête à la fin de la bande colorée', () => {
    expect(
      findHeaderEnd(medians([WHITE, 3], [0, 2], [HEADER, 10], [STRIPE, 20], [WHITE, 20])),
    ).toBe(15);
  });

  it('renvoie 0 sans bande colorée', () => {
    expect(findHeaderEnd(medians([WHITE, 10], [0, 1], [STRIPE, 10]))).toBe(0);
  });

  it('ignore un liseré d’anticrénelage, avant comme après l’en-tête', () => {
    const rows = medians([WHITE, 2], [180, 1], [HEADER, 10], [WHITE, 5], [180, 1], [WHITE, 30]);
    expect(findHeaderEnd(rows)).toBe(13);
  });

  it('prend la dernière de deux bandes d’en-tête, mais ignore une bande du bas du tableau', () => {
    expect(findHeaderEnd(medians([HEADER, 8], [0, 1], [HEADER, 6], [WHITE, 40]))).toBe(15);
    expect(findHeaderEnd(medians([WHITE, 30], [HEADER, 10]))).toBe(0);
  });
});

describe('findTextBands / rowPitch', () => {
  it('repère les lignes de texte et écarte le bruit', () => {
    const profile = [
      0, 0, 9, 9, 9, 9, 0, 0, 0, 0, 0, 1, 0, 9, 9, 9, 0, 0, 0, 0, 0, 0, 9, 9, 9, 9, 0,
    ];
    // Largeur 400 : une rangée porte du texte à partir de 2 pixels d'encre.
    expect(findTextBands(profile, 400)).toEqual([
      { start: 2, end: 5 },
      { start: 13, end: 15 },
      { start: 22, end: 25 },
    ]);
  });

  it('écarte une bande bien plus fine que les autres', () => {
    const profile = [9, 9, 9, 9, 9, 0, 0, 9, 0, 0, 9, 9, 9, 9, 9, 0, 0, 0, 0, 0, 9, 9, 9, 9, 9];
    expect(findTextBands(profile, 100).map((band) => band.start)).toEqual([0, 10, 20]);
  });

  it('mesure la hauteur de ligne par l’écart médian entre bandes', () => {
    const bands = [0, 10, 20, 31, 41].map((start) => ({ start, end: start + 4 }));
    expect(rowPitch(bands)).toBe(10);
    expect(rowPitch(bands.slice(0, 1))).toBeNull();
    expect(rowPitch([])).toBeNull();
  });
});

describe('columnsFromRules', () => {
  const rules = [0, 31, 91].map((start) => ({ start, end: start }));

  it('délimite les colonnes par les filets, marges étroites exclues', () => {
    expect(columnsFromRules(rules, { width: 120, rowHeight: 10 })).toEqual([
      { left: 1, right: 31 },
      { left: 32, right: 91 },
      { left: 92, right: 120 },
    ]);
    // La marge à droite du dernier filet (4 px) n'est pas une colonne.
    expect(columnsFromRules(rules, { width: 96, rowHeight: 10 })).toHaveLength(2);
  });

  it('sans filet : une seule colonne, toute la largeur', () => {
    expect(columnsFromRules([], { width: 120, rowHeight: 10 })).toEqual([{ left: 0, right: 120 }]);
  });
});

describe('columnsFromGutters', () => {
  // Profil : marge, « mot mot » (espace de 3 px), gouttière de 6, texte, gouttière de 12, texte, marge.
  const profile = [
    ...Array(4).fill(0),
    ...Array(10).fill(20),
    ...Array(3).fill(0),
    ...Array(10).fill(20),
    ...Array(6).fill(0),
    ...Array(20).fill(20),
    ...Array(12).fill(0),
    ...Array(15).fill(20),
    ...Array(5).fill(0),
  ];
  const options = { height: 100, rowHeight: 10 };

  it('coupe au milieu des plus larges gouttières, pas dans l’espace entre deux mots', () => {
    expect(columnsFromGutters(profile, { ...options, count: 3 })).toEqual([
      { left: 0, right: 30 },
      { left: 30, right: 59 },
      { left: 59, right: 85 },
    ]);
  });

  it('tolère quelques pixels d’encre parasites dans une gouttière', () => {
    const noisy = [...profile];
    noisy[55] = 0.4;
    expect(columnsFromGutters(noisy, { ...options, count: 3 })).toHaveLength(3);
  });

  it('renvoie null s’il manque des gouttières', () => {
    expect(columnsFromGutters(profile, { ...options, count: 5 })).toBeNull();
  });
});

describe('analyseLayout — tableau synthétique', () => {
  it.each([1, 2, 3])('retrouve en-tête, lignes et colonnes à l’échelle ×%i', (unit) => {
    const table = drawTable({ unit });
    const layout = analyseLayout(table.image, 9);
    expect(layout.top).toBe(table.top);
    expect(layout.rowHeight).toBe(table.rowHeight);
    expect(layout.anchors).toEqual(
      Array.from({ length: ROWS }, (_, row) => table.top + row * table.rowHeight + 5 * unit - 0.5),
    );
    expect(layout.columns).toEqual(table.columns);
  });

  it('efface cadre, quadrillage et rien d’autre', () => {
    const { image, columns, top } = drawTable();
    const { cleaned } = analyseLayout(image, 9);
    const ink = inkProfiles(cleaned, top).columns;
    expect(ink[0]).toBe(0);
    for (const column of columns) {
      expect(cleaned.data[top * image.width + column.right]).toBe(WHITE);
      expect(ink[column.left + 3]).toBe(ROWS * 4);
    }
  });

  it('sans quadrillage : se rabat sur les gouttières entre colonnes', () => {
    const table = drawTable({ unit: 2, grid: false });
    const layout = analyseLayout(table.image, 9);
    expect(layout.columns).toHaveLength(9);
    layout.columns.forEach((column, index) => {
      expect(column.left).toBeLessThanOrEqual(table.blocks[index].left);
      expect(column.right).toBeGreaterThanOrEqual(table.blocks[index].right);
    });
  });

  it('sans en-tête coloré : la zone de données commence en haut', () => {
    const layout = analyseLayout(drawTable({ header: false }).image, 9);
    expect(layout.top).toBe(0);
    expect(layout.columns).toHaveLength(9);
  });

  it('renvoie null si le tableau n’a pas le nombre de colonnes attendu ou pas de lignes', () => {
    // Quadrillage à 9 colonnes pour 7 ou 10 attendues : pas de découpage hasardeux par les gouttières.
    expect(analyseLayout(drawTable().image, 7)).toBeNull();
    expect(analyseLayout(drawTable().image, 10)).toBeNull();
    expect(analyseLayout(drawTable({ grid: false }).image, 10)).toBeNull();
    const blank = { data: new Uint8Array(400).fill(WHITE), width: 20, height: 20 };
    expect(analyseLayout(blank, 9)).toBeNull();
  });
});

describe('findFullRules / findVerticalRules / eraseRules', () => {
  it('repère le cadre plein et le quadrillage clair, pas les cellules surlignées', () => {
    const { image, columns, top, rowHeight } = drawTable();
    // Deux cellules surlignées (aplat clair) dans la deuxième colonne.
    for (let y = top; y < top + 2 * rowHeight; y++) {
      for (let x = columns[1].left; x < columns[1].right; x++) {
        if (image.data[y * image.width + x] === WHITE) image.data[y * image.width + x] = 238;
      }
    }
    expect(findFullRules(image, top).columns).toEqual([{ start: 0, end: 0 }]);
    const rules = findVerticalRules(image, rowMedians(image), { top, rowHeight });
    expect(rules).toEqual(
      [0, ...columns.map((column) => column.right)].map((x) => ({ start: x, end: x })),
    );
  });

  it('blanchit un filet horizontal pleine largeur sans modifier l’image d’origine', () => {
    const image = { data: new Uint8Array(30).fill(WHITE), width: 10, height: 3 };
    image.data.fill(0, 10, 20);
    expect(findFullRules(image).rows).toEqual([1]);
    const cleaned = eraseRules(image, findFullRules(image));
    expect(cleaned.data.every((level) => level === WHITE)).toBe(true);
    expect(image.data[10]).toBe(0);
  });
});

describe('nearestLine / mergeAnchors', () => {
  const lines = [
    { y: 10, text: 'a' },
    { y: 31, text: 'b' },
    { y: 52, text: 'c' },
  ];

  it('rattache une ligne OCR à la ligne du tableau la plus proche, dans la tolérance', () => {
    expect(nearestLine(lines, 30, 9)?.text).toBe('b');
    expect(nearestLine(lines, 41, 9)).toBeNull();
    expect(nearestLine(lines, 41, 11)?.text).toBe('b');
    expect(nearestLine([], 10, 9)).toBeNull();
  });

  it('complète les ancres par les lignes vues ailleurs, sans doublon', () => {
    expect(mergeAnchors([10, 52], [11, 30, 31, 55, 73], 9)).toEqual([10, 30, 52, 73]);
    expect(mergeAnchors([], [], 9)).toEqual([]);
  });
});

describe('majority / electReading', () => {
  const rule = { isValid: (vote) => /^\d\dh\d\d$/.test(vote), quorum: 3, maxDissent: 1 };

  it('majority : valeur la plus fréquente, la première lue à égalité', () => {
    expect(majority(['a', 'b', 'b'])).toEqual({ value: 'b', count: 2 });
    expect(majority(['a', 'b'])).toEqual({ value: 'a', count: 1 });
    expect(majority([])).toBeNull();
  });

  it('lecture sûre quand le quorum de lectures valides concordantes est atteint', () => {
    expect(electReading(['08h45', '08h45', '08h45'], rule)).toEqual({ value: '08h45', sure: true });
    expect(electReading(['08h45', '0845', '08h45', '08h45', '08h45', '09h45'], rule)).toEqual({
      value: '08h45',
      sure: true,
    });
  });

  it('signale un vote partagé, même si le quorum est atteint', () => {
    const split = ['08h00', '08h00', '09h00', '08h00', '09h00', '09h00'];
    expect(electReading(split, rule)).toEqual({ value: '08h00', sure: false });
    expect(electReading(['08h45', '08h45', '09h45'], rule).sure).toBe(false);
  });

  it('sans lecture valide : rend la meilleure lecture brute, signalée', () => {
    expect(electReading(['11h65', '11h65', '1h65'], rule)).toEqual({ value: '11h65', sure: false });
    expect(electReading(['', '', ''], rule)).toEqual({ value: null, sure: false });
  });

  it('cellule facultative lue vide en majorité : absente, sans signalement', () => {
    const optional = { ...rule, optional: true };
    expect(electReading(['', '', ''], optional)).toEqual({ value: null, sure: true });
    expect(electReading(['', '1', ''], optional)).toEqual({ value: null, sure: true });
    expect(electReading(['', '08h45', ''], optional)).toEqual({ value: '08h45', sure: false });
  });
});

describe('parseRawText — repli sur le texte brut de l’image entière', () => {
  const rows = parseRawText(fixture('exam-raw.txt'));
  // Vérité terrain : la première ligne du tableau (TOEIC Initial) manque dans ce texte, et l'OCR y a lu
  // « 11h65 » pour 11h45 — c'est à `parseExams` de le signaler.
  const truth = JSON.parse(fixture('exam-rows.json'))
    .slice(1)
    .map(({ date, debut, fin }) => ({ date, debut, fin: fin === '11h45' ? '11h65' : fin }));

  it('retrouve les dates et heures de toutes les lignes du texte', () => {
    expect(rows).toHaveLength(31);
    expect(rows.map(({ date, debut, fin }) => ({ date, debut, fin }))).toEqual(truth);
  });

  it('découpe les cellules par leurs longs espaces', () => {
    expect(rows[1]).toEqual({
      formation: 'FISE Informatique A3',
      element: 'Sciences fondamentales - Sciences du numérique (CCTL)',
      bloc: "[A3 FISE info] Sciences fondamentales de l'ingénieur",
      format: 'Test',
      plateforme: '',
      session: 'Initiale',
      date: '05/11/2026',
      debut: '08h45',
      fin: '09h40',
      flags: ['date', 'horaire'],
    });
    expect(rows.every((row) => row.formation === 'FISE Informatique A3')).toBe(true);
    expect(
      rows.map((row) => row.session).filter((session) => session === 'Rattrapage'),
    ).toHaveLength(14);
  });

  it('marque chaque ligne comme lecture dégradée', () => {
    expect(rows.every((row) => row.flags.join() === 'date,horaire')).toBe(true);
  });

  it('écarte l’en-tête et le bruit, sans jamais lever d’exception', () => {
    expect(parseRawText('')).toEqual([]);
    expect(parseRawText(null)).toEqual([]);
    expect(
      parseRawText('T    Le)    [=]   [=]   El   =\n\n ~~ |||\n-      Horaire Horaire'),
    ).toEqual([]);
  });

  it('garde une ligne sans date si elle a la carrure d’une ligne du tableau', () => {
    const [row] = parseRawText(
      'FISE Informatique A3    Génie logiciel (CCTL)    Bloc    Test    Initiale    8h45  9h40',
    );
    expect(row).toMatchObject({
      element: 'Génie logiciel (CCTL)',
      session: 'Initiale',
      date: null,
      debut: '08h45',
      fin: '09h40',
    });
  });

  it('lit une date suivie de bruit et une heure seule', () => {
    const [row] = parseRawText(
      'FISE Informatique A3    Épreuve    Bloc    Test    Rattrapage    3/6/2027   14h00 |',
    );
    expect(row).toMatchObject({
      session: 'Rattrapage',
      date: '03/06/2027',
      debut: '14h00',
      fin: null,
    });
  });
});

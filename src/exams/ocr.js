// Lecture OCR locale (Tesseract, sans réseau) du calendrier des examens : une capture d'un tableau Excel.
// Chaque colonne est lue séparément (une bande verticale), puis les lignes sont recollées par leur ordonnée.
import fra from '@tesseract.js-data/fra';
import sharp from 'sharp';
import { createWorker, OEM, PSM } from 'tesseract.js';
import { ExamError } from './errors.js';
import { analyseLayout, electReading, inkProfiles, mergeAnchors, nearestLine } from './layout.js';
import { parseRawText } from './rawText.js';

export const COLUMNS = Object.freeze([
  'formation',
  'element',
  'bloc',
  'format',
  'plateforme',
  'session',
  'date',
  'debut',
  'fin',
]);
const TEXT_COLUMNS = COLUMNS.slice(0, 6);
const DATE = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/20\d\d$/;
const TIME = /^([01]\d|2[0-3])h[0-5]\d$/;
// Cellules relues plusieurs fois avec une liste blanche de caractères, puis départagées par vote.
const VOTED_COLUMNS = Object.freeze([
  { name: 'date', flag: 'date', whitelist: '0123456789/', pattern: DATE, optional: false },
  { name: 'debut', flag: 'horaire', whitelist: '0123456789h', pattern: TIME, optional: true },
  { name: 'fin', flag: 'horaire', whitelist: '0123456789h', pattern: TIME, optional: true },
]);

// Hauteur d'une ligne du tableau (px) dans l'image donnée à Tesseract : l'agrandissement se déduit de la
// hauteur de ligne mesurée, donc ne dépend pas de la résolution de la capture.
const TEXT_ROW_PX = 63;
const VOTE_ROW_PX = Object.freeze([42, 63, 84]);
const CELL_ROW_PX = Object.freeze([63, 84, 105]);
// Lectures valides concordantes exigées pour ne pas signaler une cellule.
const QUORUM = VOTE_ROW_PX.length;
// … et lectures valides divergentes tolérées (après relecture de la cellule).
const MAX_DISSENT = 1;
// Une ligne OCR appartient à la ligne du tableau dont le centre est à moins d'une demi-ligne.
const LINE_TOLERANCE_ROWS = 0.45;
const CELL_HEIGHT_ROWS = 0.86;
// Marge blanche (px) autour des bandes et des cellules : Tesseract lit mal un texte collé au bord.
const STRIP_PADDING = 20;
const CELL_PADDING = 15;
const OCR_DPI = 300;
// `normalise()` cale le noir sur le 1er centile : dans une zone presque vide, le gris des lignes
// alternées deviendrait noir. En dessous de ce taux d'encre (et pour une cellule seule), le contraste
// est étiré entre deux niveaux fixes, ce qui blanchit aussi le fond.
const SPARSE_INK_RATIO = 0.02;
const STRETCH_BLACK = 40;
const STRETCH_WHITE = 215;
// Sous cette hauteur de ligne (px) dans la capture, les chiffres ne sont plus fiables : tout est signalé.
const LEGIBLE_ROW_PX = 15;
const ALL_FLAGS = Object.freeze([...new Set(VOTED_COLUMNS.map((column) => column.flag))]);
// Repli : agrandissement sans hauteur de ligne connue, et largeur maximale donnée à Tesseract.
const FALLBACK_SCALE = 3;
const FALLBACK_MAX_WIDTH = 6000;
// Garde-fou : si la colonne Date ne contient pas de dates, les colonnes sont mal placées.
const MIN_DATED_RATIO = 0.5;
// Libellé de la première colonne, cherché seulement parmi les toutes premières lignes lues.
const HEADER_LABEL = /^formation\b/i;
const HEADER_MAX_ROWS = 4;

const compact = (text) => text.replace(/\s+/g, ' ').trim();
const squeeze = (text) => text.replace(/\s+/g, '');

async function toGray(bytes) {
  try {
    const { data, info } = await sharp(bytes)
      .flatten({ background: '#ffffff' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new ExamError('image du calendrier des examens illisible');
  }
}

// Extrait une zone de l'image sans filets, agrandie et contrastée pour Tesseract.
function render({ cleaned }, area, { scale, padding, sparse }) {
  const { data, width, height } = cleaned;
  const zone = sharp(data, { raw: { width, height, channels: 1 } })
    .extract(area)
    .resize({ width: Math.max(1, Math.round(area.width * scale)) });
  const gain = 255 / (STRETCH_WHITE - STRETCH_BLACK);
  return (sparse ? zone.linear(gain, -STRETCH_BLACK * gain) : zone.normalise())
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: '#ffffff',
    })
    .withMetadata({ density: OCR_DPI })
    .png()
    .toBuffer();
}

function isSparse({ cleaned, top, ink }, { left, right }) {
  const inked = ink.subarray(left, right).reduce((sum, count) => sum + count, 0);
  return inked < (right - left) * (cleaned.height - top) * SPARSE_INK_RATIO;
}

// Lit une colonne entière : lignes `{ y, text }`, `y` dans le repère de l'image d'origine.
async function readStrip({ worker, layout }, column, { rowPx, whitelist = '' }) {
  const scale = rowPx / layout.rowHeight;
  const area = {
    left: column.left,
    top: layout.top,
    width: column.right - column.left,
    height: layout.cleaned.height - layout.top,
  };
  const png = await render(layout, area, {
    scale,
    padding: STRIP_PADDING,
    sparse: isSparse(layout, column),
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    tessedit_char_whitelist: whitelist,
    preserve_interword_spaces: '1',
  });
  const { data } = await worker.recognize(png, {}, { blocks: true });
  return (data.blocks ?? [])
    .flatMap((block) => block.paragraphs)
    .flatMap((paragraph) => paragraph.lines)
    .filter((line) => line.text.trim() !== '')
    .map((line) => ({
      y: ((line.bbox.y0 + line.bbox.y1) / 2 - STRIP_PADDING) / scale + layout.top,
      text: line.text,
    }));
}

// Relit une seule cellule, comme une ligne de texte isolée.
async function readCell({ worker, layout }, column, y, { rowPx, whitelist }) {
  const { rowHeight, cleaned } = layout;
  const height = Math.max(1, Math.round(rowHeight * CELL_HEIGHT_ROWS));
  const top = Math.min(Math.max(0, Math.round(y - height / 2)), cleaned.height - height);
  const area = { left: column.left, top, width: column.right - column.left, height };
  const png = await render(layout, area, {
    scale: rowPx / rowHeight,
    padding: CELL_PADDING,
    sparse: true,
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    tessedit_char_whitelist: whitelist,
    preserve_interword_spaces: '0',
  });
  const { data } = await worker.recognize(png);
  return squeeze(data.text);
}

async function readTextStrips(reader) {
  const strips = {};
  for (const name of TEXT_COLUMNS) {
    const column = reader.layout.columns[COLUMNS.indexOf(name)];
    strips[name] = await readStrip(reader, column, { rowPx: TEXT_ROW_PX });
  }
  return strips;
}

async function readVotedStrips(reader) {
  const strips = {};
  for (const { name, whitelist } of VOTED_COLUMNS) {
    const column = reader.layout.columns[COLUMNS.indexOf(name)];
    strips[name] = [];
    for (const rowPx of VOTE_ROW_PX) {
      strips[name].push(await readStrip(reader, column, { rowPx, whitelist }));
    }
  }
  return strips;
}

// Vote sur les lectures en bande ; sans accord, relecture de la cellule seule avant de signaler.
async function readVotedCell(reader, voted, strips, y) {
  const tolerance = reader.layout.rowHeight * LINE_TOLERANCE_ROWS;
  const rule = {
    isValid: (vote) => voted.pattern.test(vote),
    quorum: QUORUM,
    maxDissent: MAX_DISSENT,
    optional: voted.optional,
  };
  const votes = strips.map((lines) => squeeze(nearestLine(lines, y, tolerance)?.text ?? ''));
  const first = electReading(votes, rule);
  if (first.sure) return first;
  const column = reader.layout.columns[COLUMNS.indexOf(voted.name)];
  for (const rowPx of CELL_ROW_PX) {
    votes.push(await readCell(reader, column, y, { rowPx, whitelist: voted.whitelist }));
  }
  return electReading(votes, rule);
}

async function readRow(reader, { text, voted }, y) {
  const tolerance = reader.layout.rowHeight * LINE_TOLERANCE_ROWS;
  const row = {};
  for (const name of TEXT_COLUMNS) {
    row[name] = compact(nearestLine(text[name], y, tolerance)?.text ?? '');
  }
  const flags = new Set();
  for (const column of VOTED_COLUMNS) {
    const { value, sure } = await readVotedCell(reader, column, voted[column.name], y);
    row[column.name] = value;
    if (!sure) flags.add(column.flag);
  }
  return { ...row, flags: [...flags] };
}

// Une vraie ligne remplit plusieurs cellules ; une seule, c'est une ancre fantôme (deux lignes que l'OCR
// a fondues en une, entre deux lignes du tableau).
const MIN_ROW_CELLS = 2;
const isRow = (row) => COLUMNS.filter((name) => row[name]).length >= MIN_ROW_CELLS;

// En-tête non coloré : il n'a pas été écarté par la géométrie, mais sa cellule « Formation » le trahit.
function dropHeaderRows(rows) {
  const label = rows
    .slice(0, HEADER_MAX_ROWS)
    .findLastIndex((row) => HEADER_LABEL.test(row.formation));
  return rows.slice(label + 1);
}

async function readColumns(reader) {
  const { layout } = reader;
  const text = await readTextStrips(reader);
  const voted = await readVotedStrips(reader);
  // Ancres = lignes de texte vues dans l'image, complétées par ce que l'OCR lit en Formation et en Date :
  // une ligne dont une cellule est illisible reste présente.
  const anchors = mergeAnchors(
    layout.anchors,
    [...text.formation, ...voted.date.flat()].map((line) => line.y),
    layout.rowHeight * LINE_TOLERANCE_ROWS,
  );
  const rows = [];
  for (const y of anchors) rows.push(await readRow(reader, { text, voted }, y));
  const kept = dropHeaderRows(rows.filter(isRow));
  if (layout.rowHeight >= LEGIBLE_ROW_PX) return kept;
  return kept.map((row) => ({ ...row, flags: [...ALL_FLAGS] }));
}

const looksRight = (rows) =>
  rows.length > 0 &&
  rows.filter((row) => DATE.test(row.date ?? '')).length >= rows.length * MIN_DATED_RATIO;

// Repli : une passe sur l'image entière, découpée ensuite d'après le texte seul.
async function readWhole(worker, bytes, { width }, rowHeight) {
  const wanted = rowHeight ? TEXT_ROW_PX / rowHeight : FALLBACK_SCALE;
  const scale = Math.min(wanted, FALLBACK_MAX_WIDTH / width);
  const png = await sharp(bytes)
    .flatten({ background: '#ffffff' })
    .resize({ width: Math.round(width * scale) })
    .grayscale()
    .withMetadata({ density: OCR_DPI })
    .png()
    .toBuffer();
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    tessedit_char_whitelist: '',
    preserve_interword_spaces: '1',
  });
  const { data } = await worker.recognize(png);
  return parseRawText(data.text);
}

/**
 * Lit le tableau des examens d'une image. Renvoie `{ rows, mode }` : `rows` dans l'ordre du tableau,
 * `{ formation, element, bloc, format, plateforme, session, date, debut, fin, flags }` en texte brut
 * (`date` `JJ/MM/AAAA`, heures `08h45`, ou `null`) ; `flags` ⊆ `['date', 'horaire']` signale une lecture
 * incertaine. `mode` vaut `'columns'`, ou `'fallback'` quand les neuf colonnes n'ont pas été retrouvées.
 */
export async function readExamTable(bytes) {
  const image = await toGray(bytes);
  const layout = analyseLayout(image, COLUMNS.length);
  // Données de langue embarquées : aucun téléchargement, aucun cache sur disque.
  const worker = await createWorker(fra.code, OEM.LSTM_ONLY, {
    langPath: fra.langPath,
    gzip: fra.gzip,
    cacheMethod: 'none',
  });
  try {
    if (layout) {
      const ink = inkProfiles(layout.cleaned, layout.top).columns;
      const rows = await readColumns({ worker, layout: { ...layout, ink } });
      if (looksRight(rows)) return { rows, mode: 'columns' };
    }
    return { rows: await readWhole(worker, bytes, image, layout?.rowHeight), mode: 'fallback' };
  } finally {
    await worker.terminate();
  }
}

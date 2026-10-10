// Géométrie du tableau des examens : fonctions pures, sans OCR, sur une image en niveaux de gris
// `{ data, width, height }` (un octet par pixel). Les seuils sont des niveaux de gris ou des proportions
// (de l'image, de la hauteur de ligne mesurée) : rien ne dépend de la résolution de la capture.

// En dessous : encre (texte, filets noirs). Au-dessus de BACKGROUND_MIN : fond (blanc, lignes alternées).
const INK_MAX = 140;
const BACKGROUND_MIN = 215;
// Un filet plein couvre presque toute la largeur.
const FULL_RULE_RATIO = 0.9;
// L'en-tête coloré se termine dans la moitié haute ; une bande bien plus fine que la plus épaisse est ignorée.
const HEADER_MAX_RATIO = 0.5;
const HEADER_BAND_RATIO = 0.5;
// Une rangée de pixels porte du texte au-delà de cette part d'encre ; une bande trop fine est du bruit.
const TEXT_ROW_MIN_INK_RATIO = 0.003;
const BAND_MIN_HEIGHT_RATIO = 0.4;
// Filet vertical (y compris le quadrillage gris clair d'Excel) : plus sombre que le fond de sa rangée,
// d'un seul tenant sur presque une ligne (un glyphe est plus court), sur une bonne part de la hauteur, et fin.
const RULE_CONTRAST = 12;
const RULE_MIN_RUN_ROWS = 0.75;
const RULE_MIN_COVERAGE = 0.3;
const RULE_MAX_WIDTH_ROWS = 0.3;
// Une colonne fait au moins une hauteur de ligne de large (écarte les marges entre bord et cadre).
const COLUMN_MIN_WIDTH_ROWS = 1;
// Gouttière : suite de colonnes de pixels (presque) sans encre.
const GUTTER_MAX_INK_RATIO = 0.005;
const GUTTER_MIN_WIDTH_ROWS = 0.2;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// Suites maximales d'indices `[from, to[` vérifiant `test`, sous la forme `{ start, end }` (bornes incluses).
function runs(from, to, test) {
  const found = [];
  let start = null;
  for (let index = from; index <= to; index++) {
    const inside = index < to && test(index);
    if (inside && start === null) start = index;
    if (!inside && start !== null) {
      found.push({ start, end: index - 1 });
      start = null;
    }
  }
  return found;
}

const size = (run) => run.end - run.start + 1;
const center = (run) => (run.start + run.end) / 2;

/** Gris médian de chaque rangée : le fond de la rangée, quel que soit le texte qu'elle porte. */
export function rowMedians({ data, width, height }) {
  const medians = new Uint8Array(height);
  const histogram = new Uint32Array(256);
  for (let y = 0; y < height; y++) {
    histogram.fill(0);
    for (let x = 0; x < width; x++) histogram[data[y * width + x]]++;
    let seen = 0;
    let level = 0;
    while ((seen += histogram[level]) * 2 < width) level++;
    medians[y] = level;
  }
  return medians;
}

/**
 * Première rangée sous l'en-tête : fin de la dernière bande colorée (fond ni blanc ni noir) du haut de l'image.
 * 0 si l'en-tête n'est pas coloré (les lignes d'en-tête sont alors écartées d'après leur texte).
 */
export function findHeaderEnd(medians) {
  const colored = runs(
    0,
    medians.length,
    (y) => medians[y] >= INK_MAX && medians[y] < BACKGROUND_MIN,
  );
  if (colored.length === 0) return 0;
  const thickest = Math.max(...colored.map(size));
  const header = colored.filter(
    (band) =>
      size(band) >= thickest * HEADER_BAND_RATIO && band.end < medians.length * HEADER_MAX_RATIO,
  );
  return header.length === 0 ? 0 : header.at(-1).end + 1;
}

/**
 * Filets pleins : `rows` (rangées sombres sur toute la largeur) et `columns` (plages `{ start, end }`
 * sombres sur toute la hauteur sous `top`, c'est-à-dire le cadre).
 */
export function findFullRules({ data, width, height }, top = 0) {
  const dark = (x, y) => data[y * width + x] < BACKGROUND_MIN;
  const rows = [];
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) if (dark(x, y)) count++;
    if (count > width * FULL_RULE_RATIO) rows.push(y);
  }
  const columns = runs(0, width, (x) => {
    let count = 0;
    for (let y = top; y < height; y++) if (dark(x, y)) count++;
    return count > (height - top) * FULL_RULE_RATIO;
  });
  return { rows, columns };
}

/**
 * Filets verticaux `{ start, end }` de la zone de données (sous `top`), cadre et quadrillage compris.
 * `medians` vient de `rowMedians` ; `rowHeight` est la hauteur de ligne mesurée.
 */
export function findVerticalRules({ data, width, height }, medians, { top, rowHeight }) {
  const minRun = rowHeight * RULE_MIN_RUN_ROWS;
  const minCovered = (height - top) * RULE_MIN_COVERAGE;
  const isRule = (x) => {
    let covered = 0;
    let run = 0;
    for (let y = top; y <= height; y++) {
      if (y < height && medians[y] - data[y * width + x] >= RULE_CONTRAST) {
        run++;
        continue;
      }
      if (run >= minRun) covered += run;
      run = 0;
    }
    return covered >= minCovered;
  };
  // Une plage large n'est pas un filet mais un aplat (cellules surlignées).
  return runs(0, width, isRule).filter((rule) => size(rule) <= rowHeight * RULE_MAX_WIDTH_ROWS);
}

/** Copie de l'image où les filets (rangées pleines, plages de colonnes) sont blanchis. */
export function eraseRules({ data, width, height }, { rows = [], columns = [] }) {
  const cleaned = Uint8Array.from(data);
  for (const y of rows) cleaned.fill(255, y * width, (y + 1) * width);
  for (const { start, end } of columns) {
    for (let y = 0; y < height; y++) cleaned.fill(255, y * width + start, y * width + end + 1);
  }
  return { data: cleaned, width, height };
}

/** Nombre de pixels d'encre par rangée et par colonne, sous `top`. */
export function inkProfiles({ data, width, height }, top = 0) {
  const rows = new Uint32Array(height);
  const columns = new Uint32Array(width);
  for (let y = top; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] >= INK_MAX) continue;
      rows[y]++;
      columns[x]++;
    }
  }
  return { rows, columns };
}

/** Bandes de texte `{ start, end }` d'un profil d'encre par rangée (image de largeur `width`). */
export function findTextBands(rowInk, width) {
  const minInk = Math.max(1, Math.ceil(width * TEXT_ROW_MIN_INK_RATIO));
  const bands = runs(0, rowInk.length, (y) => rowInk[y] >= minInk);
  if (bands.length === 0) return bands;
  const usual = median(bands.map(size));
  return bands.filter((band) => size(band) >= usual * BAND_MIN_HEIGHT_RATIO);
}

/** Hauteur de ligne : écart médian entre les centres de bandes successives ; `null` sans deux bandes. */
export function rowPitch(bands) {
  if (bands.length < 2) return null;
  return median(bands.slice(1).map((band, index) => center(band) - center(bands[index])));
}

/** Colonnes `{ left, right }` (`right` exclu) délimitées par les filets verticaux et les bords. */
export function columnsFromRules(rules, { width, rowHeight }) {
  const edges = [{ start: 0, end: -1 }, ...rules, { start: width, end: width }];
  return edges
    .slice(1)
    .map((rule, index) => ({ left: edges[index].end + 1, right: rule.start }))
    .filter(({ left, right }) => right - left >= rowHeight * COLUMN_MIN_WIDTH_ROWS);
}

/**
 * Colonnes `{ left, right }` séparées par les `count - 1` plus larges gouttières sans encre du profil
 * (les espaces entre mots alignés d'une ligne à l'autre sont plus étroits) ; `null` s'il en manque.
 */
export function columnsFromGutters(columnInk, { height, rowHeight, count }) {
  const width = columnInk.length;
  const maxInk = height * GUTTER_MAX_INK_RATIO;
  const gutters = runs(0, width, (x) => columnInk[x] <= maxInk)
    // Les marges gauche et droite ne séparent rien.
    .filter((gap) => gap.start > 0 && gap.end < width - 1)
    .filter((gap) => size(gap) >= rowHeight * GUTTER_MIN_WIDTH_ROWS);
  if (gutters.length < count - 1) return null;
  const cuts = gutters
    .sort((a, b) => size(b) - size(a))
    .slice(0, count - 1)
    .map((gap) => Math.round(center(gap)))
    .sort((a, b) => a - b);
  const bounds = [0, ...cuts, width];
  return bounds.slice(1).map((right, index) => ({ left: bounds[index], right }));
}

/**
 * Mise en page complète : `{ top, rowHeight, anchors, columns, cleaned }` où `anchors` sont les centres
 * des lignes de texte et `cleaned` l'image sans filets ; `null` si le tableau n'a pas `count` colonnes.
 */
export function analyseLayout(image, count) {
  const medians = rowMedians(image);
  const top = findHeaderEnd(medians);
  const full = findFullRules(image, top);
  // Le cadre vertical traverse chaque rangée : sans lui, le profil ne voit que le texte.
  const bands = findTextBands(inkProfiles(eraseRules(image, full), top).rows, image.width);
  const rowHeight = rowPitch(bands);
  if (rowHeight === null) return null;
  const rules = findVerticalRules(image, medians, { top, rowHeight });
  const cleaned = eraseRules(image, { rows: full.rows, columns: [...full.columns, ...rules] });
  const ruled = columnsFromRules(rules, { width: image.width, rowHeight });
  // Plus de filets que prévu : ce n'est pas le tableau attendu, les gouttières n'y changeraient rien.
  if (ruled.length > count) return null;
  const columns =
    ruled.length === count
      ? ruled
      : columnsFromGutters(inkProfiles(cleaned, top).columns, {
          height: image.height - top,
          rowHeight,
          count,
        });
  if (!columns) return null;
  return { top, rowHeight, anchors: bands.map(center), columns, cleaned };
}

/** Ligne `{ y, … }` la plus proche de `y` à `tolerance` près, ou `null`. */
export function nearestLine(lines, y, tolerance) {
  let best = null;
  for (const line of lines) {
    const distance = Math.abs(line.y - y);
    if (distance <= tolerance && (!best || distance < Math.abs(best.y - y))) best = line;
  }
  return best;
}

/** Union triée des ancres et des positions `ys` qui ne tombent sur aucune ancre à `tolerance` près. */
export function mergeAnchors(anchors, ys, tolerance) {
  const merged = [...anchors];
  for (const y of ys) {
    if (merged.every((anchor) => Math.abs(anchor - y) > tolerance)) merged.push(y);
  }
  return merged.sort((a, b) => a - b);
}

/** Valeur la plus fréquente `{ value, count }` (à égalité, la première lue) ; `null` sans valeur. */
export function majority(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

/**
 * Dépouille les lectures d'une même cellule : `{ value, sure }`.
 * Sûr si `quorum` lectures valides concordent sans plus de `maxDissent` lectures valides contraires,
 * ou si une cellule facultative est lue vide en majorité ; sinon la meilleure lecture disponible,
 * même invalide, pour ne rien perdre.
 */
export function electReading(votes, { isValid, quorum, maxDissent = 0, optional = false }) {
  const valid = votes.filter(isValid);
  const winner = majority(valid);
  if (winner && winner.count >= quorum && valid.length - winner.count <= maxDissent) {
    return { value: winner.value, sure: true };
  }
  const blanks = votes.filter((vote) => vote === '').length;
  if (optional && !winner && blanks * 2 > votes.length) return { value: null, sure: true };
  const fallback = winner ?? majority(votes.filter((vote) => vote !== ''));
  return { value: fallback?.value ?? null, sure: false };
}

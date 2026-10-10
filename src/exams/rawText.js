// Repli de la lecture du calendrier des examens : découpage du texte brut d'une passe OCR sur l'image entière.

// Tesseract (`preserve_interword_spaces`) rend l'écart entre deux cellules par une longue suite d'espaces.
const CELL_GAP = /\s{3,}/;
const DATE = /(\d{1,2})\s?\/\s?(\d{1,2})\s?\/\s?(\d{4})/g;
const TIME = /(\d{1,2})\s?h\s?(\d{2})/g;
const TRAILING_TIMES = /(?:\s+\d{1,2}\s?h\s?\d{2}){1,2}\s*$/;
const LETTERS = /\p{L}/gu;
// Sans date, une ligne n'est gardée que si elle a la carrure d'une ligne du tableau : assez de cellules
// et de texte (les icônes et les titres de l'en-tête donnent quelques mots épars).
const MIN_LETTERS = 12;
const MIN_CELLS = 3;
// Lecture dégradée : rien n'a été recoupé, tout est à vérifier.
const DEGRADED_FLAGS = Object.freeze(['date', 'horaire']);
const SESSION = /^(initiale|rattrapage)$/i;

const pad = (digits) => digits.padStart(2, '0');

// Coupe la ligne en `{ head, date, times }` : la date est la dernière de la ligne, les heures la suivent
// (ou, sans date, terminent la ligne).
function splitLine(line) {
  const date = [...line.matchAll(DATE)].at(-1);
  const cut = date?.index ?? TRAILING_TIMES.exec(line)?.index ?? line.length;
  const after = line.slice(date ? cut + date[0].length : cut);
  return {
    head: line.slice(0, cut),
    date: date ? `${pad(date[1])}/${pad(date[2])}/${date[3]}` : null,
    times: [...after.matchAll(TIME)].slice(0, 2).map((time) => `${pad(time[1])}h${time[2]}`),
  };
}

// Après Formation, Élément et Bloc viennent Format, Plateforme et Session, souvent vides :
// le nombre de cellules restantes décide de leur répartition.
function splitTail(cells) {
  if (cells.length >= 3) {
    return { format: cells[0], plateforme: cells.slice(1, -1).join(' '), session: cells.at(-1) };
  }
  if (cells.length === 2) return { format: cells[0], plateforme: '', session: cells[1] };
  const [only = ''] = cells;
  return SESSION.test(only)
    ? { format: '', plateforme: '', session: only }
    : { format: only, plateforme: '', session: '' };
}

function parseLine(line) {
  const { head, date, times } = splitLine(line);
  const cells = head
    .split(CELL_GAP)
    .map((cell) => cell.trim())
    .filter(Boolean);
  const letters = (line.match(LETTERS) ?? []).length;
  if (!date && (cells.length < MIN_CELLS || letters < MIN_LETTERS)) return null;
  const [formation = '', element = '', bloc = '', ...tail] = cells;
  return {
    formation,
    element,
    bloc,
    ...splitTail(tail),
    date,
    debut: times[0] ?? null,
    fin: times[1] ?? null,
    flags: [...DEGRADED_FLAGS],
  };
}

/**
 * Lignes du tableau `{ formation, element, bloc, format, plateforme, session, date, debut, fin, flags }`
 * tirées du texte brut. Une ligne illisible est ignorée ou rendue telle quelle, jamais d'exception.
 */
export function parseRawText(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map(parseLine)
    .filter(Boolean);
}

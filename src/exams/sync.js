// Calendrier des examens : image Moodle -> OCR -> examens validés et corrigés -> base.
import { createHash } from 'node:crypto';
import { getExamSource, listExams, replaceExams } from '../db/examens.js';
import { log as defaultLog } from '../log.js';
import { truncate } from '../text.js';
import { applyCorrections, loadCorrections } from './corrections.js';
import { linkCourses } from './courseLinks.js';
import { ExamError } from './errors.js';
import { readExamTable } from './ocr.js';
import { parseExams } from './parse.js';

// Les libellés viennent de l'OCR d'un document tiers : journalisés tronqués.
const MAX_LOGGED_LABEL = 80;
const label = (value) => truncate(String(value ?? ''), MAX_LOGGED_LABEL);

// À incrémenter quand la lecture ou le parsing change : les examens déjà en base sont alors relus.
const READER_VERSION = '2';

// L'empreinte couvre l'image, les corrections et la version du lecteur : tout changement relance la lecture.
const fingerprint = (bytes, corrections) =>
  createHash('sha256')
    .update(READER_VERSION)
    .update('\n')
    .update(bytes)
    .update('\n')
    .update(corrections)
    .digest('hex');

function report(log, { exams, rows, mode, unmatched }) {
  const degraded = mode === 'fallback' ? ' (lecture dégradée : tout est à vérifier)' : '';
  log(`Examens : ${exams.length} examen(s) pour ${rows} ligne(s) lue(s), mode ${mode}${degraded}.`);
  for (const exam of exams.filter((item) => item.aVerifier.length > 0)) {
    log(`  À vérifier (${exam.aVerifier.join(', ')}) : ${label(exam.element)}, ${exam.date}`);
  }
  for (const { element, session } of unmatched) {
    const suffix = session ? ` (${label(session)})` : '';
    log(`  Correction sans correspondance : ${label(element)}${suffix}`);
  }
}

/**
 * Synchronise le calendrier des examens du périmètre `exams` (`config.exams`) vers la base.
 * Renvoie `{ exams, imageUrl, cached, mode }` ; `cached` quand ni l'image ni les corrections n'ont
 * changé (pas d'OCR, `mode` vaut `null`). Lève `ExamError` plutôt que de vider la base sur une lecture ratée.
 */
export async function syncExams({
  moodle,
  pool,
  exams: settings,
  readTable = readExamTable,
  log = defaultLog,
}) {
  const scope = { filiere: settings.filiere, niveau: settings.niveau, annee: settings.annee };
  // Avant tout accès réseau : un fichier de corrections invalide arrête l'étape tout de suite.
  const corrections = await loadCorrections(settings.correctionsFile);
  const image = await moodle.fetchExamCalendar({ niveau: scope.niveau, annee: scope.annee });
  const sourceHash = fingerprint(image.bytes, corrections.text);
  const source = await getExamSource(pool, scope);
  if (source?.sourceHash === sourceHash) {
    const exams = await listExams(pool, scope);
    log(`Examens : source inchangée, ${exams.length} examen(s) en base.`);
    return { exams, imageUrl: image.url, cached: true, mode: null };
  }

  const { rows, mode } = await readTable(image.bytes);
  const read = parseExams(rows, scope);
  if (read.length === 0) {
    throw new ExamError(
      `aucun examen lu pour ${scope.filiere} ${scope.niveau} (${rows.length} ligne(s), mode ${mode}) : base inchangée`,
    );
  }
  const corrected = applyCorrections(read, corrections.entries, scope);
  // Après les corrections : les examens ajoutés à la main reçoivent aussi leur lien.
  const exams = linkCourses(corrected.exams, image.courses ?? [], scope);
  const { unmatched } = corrected;
  await replaceExams(pool, scope, exams, { sourceHash, imageUrl: image.url });
  report(log, { exams, rows: rows.length, mode, unmatched });
  return { exams, imageUrl: image.url, cached: false, mode };
}

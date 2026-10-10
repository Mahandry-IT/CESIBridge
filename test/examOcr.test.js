// Test d'intégration : OCR réel (Tesseract local, sans réseau) sur une vraie capture du calendrier.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ExamError } from '../src/exams/errors.js';
import { readExamTable } from '../src/exams/ocr.js';
import { parseExams } from '../src/exams/parse.js';

const fixture = (name) => readFileSync(join(import.meta.dirname, 'fixtures', name));
const image = fixture('exam-calendar.png');
// Vérité terrain vérifiée à la main sur l'image : 32 lignes.
const truth = JSON.parse(fixture('exam-rows.json').toString('utf8'));
const scope = { filiere: 'FISE Informatique', niveau: 'A3', annee: '2026-2027' };
const OCR_TIMEOUT_MS = 120_000;

const schedule = (rows) => rows.map(({ date, debut, fin }) => ({ date, debut, fin }));

// Chaque lecture a son propre worker Tesseract : les cas peuvent tourner en parallèle.
describe.concurrent('readExamTable', () => {
  it(
    'lit les 32 lignes de la capture, dates et heures exactes, sans rien signaler',
    async () => {
      const { rows, mode } = await readExamTable(image);

      expect(mode).toBe('columns');
      expect(rows).toHaveLength(32);
      expect(schedule(rows)).toEqual(schedule(truth));
      expect(rows.flatMap((row) => row.flags)).toEqual([]);
      // Bout en bout : mêmes examens (libellés, sessions, identifiants) que la lecture de référence.
      expect(parseExams(rows, scope)).toEqual(parseExams(truth, scope));
    },
    OCR_TIMEOUT_MS,
  );

  it(
    'lit la même capture agrandie ×1,25 : rien ne dépend d’une taille en pixels',
    async () => {
      const { width } = await sharp(image).metadata();
      const enlarged = await sharp(image)
        .resize({ width: Math.round(width * 1.25) })
        .png()
        .toBuffer();
      const { rows, mode } = await readExamTable(enlarged);

      expect(mode).toBe('columns');
      expect(rows).toHaveLength(32);
      expect(schedule(rows)).toEqual(schedule(truth));
      // Les libellés peuvent varier d'un caractère avec le rééchantillonnage : seuls le compte,
      // les dates et les horaires sont exigés ici.
      const exams = parseExams(rows, scope);
      expect(exams).toHaveLength(32);
      expect(exams.flatMap((exam) => exam.aVerifier)).toEqual([]);
    },
    OCR_TIMEOUT_MS,
  );

  it(
    'image sans tableau : repli, aucune ligne, pas d’exception',
    async () => {
      const blank = await sharp({
        create: { width: 300, height: 120, channels: 3, background: '#ffffff' },
      })
        .png()
        .toBuffer();
      expect(await readExamTable(blank)).toEqual({ rows: [], mode: 'fallback' });
    },
    OCR_TIMEOUT_MS,
  );

  it('octets qui ne sont pas une image : ExamError, sans lancer Tesseract', async () => {
    await expect(readExamTable(Buffer.from('<html>session expirée</html>'))).rejects.toThrow(
      ExamError,
    );
  });
});

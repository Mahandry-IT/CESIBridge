import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamError } from '../src/exams/errors.js';
import { syncExams } from '../src/exams/sync.js';

const IMAGE_URL = 'https://moodle.cesi.fr/pluginfile.php/1/calendrier.png';
const bytes = Buffer.from('image du calendrier');
const sha256 = (...parts) => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
};

const row = (element, extra = {}) => ({
  formation: 'FISE Informatique A3',
  element,
  bloc: 'Bloc',
  format: 'Test',
  plateforme: '',
  session: 'Initiale',
  date: '05/11/2026',
  debut: '08h45',
  fin: '09h40',
  flags: [],
  ...extra,
});

const fakeMoodle = () => ({
  fetchExamCalendar: vi.fn(async () => ({
    bytes,
    contentType: 'image/png',
    url: IMAGE_URL,
    courseId: 7,
    courseName: 'Ma session A3',
  })),
});

// Faux pool pg : répond à `getExamSource` et `listExams`, et journalise les écritures de `replaceExams`.
function fakePool({ source = null, stored = [] } = {}) {
  const calls = [];
  const query = async (sql, params) => {
    const text = String(sql).trim().replace(/\s+/g, ' ');
    calls.push({ text, params });
    if (text.startsWith('SELECT source_hash')) {
      return {
        rows: source ? [{ source_hash: source.sourceHash, image_url: source.imageUrl }] : [],
      };
    }
    if (text.startsWith('SELECT id')) return { rows: stored };
    return { rows: [] };
  };
  const writes = () => calls.filter(({ text }) => !text.startsWith('SELECT'));
  return { calls, writes, query, connect: async () => ({ query, release() {} }) };
}

describe('syncExams', () => {
  let dir;
  let settings;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cesibridge-exam-sync-'));
    settings = {
      filiere: 'FISE Informatique',
      niveau: 'A3',
      annee: '2026-2027',
      reminderDays: [1],
      correctionsFile: join(dir, 'exam-corrections.json'),
    };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const run = (overrides = {}) => {
    const deps = {
      moodle: fakeMoodle(),
      pool: fakePool(),
      readTable: vi.fn(async () => ({
        rows: [row('Épreuve A'), row('Épreuve B')],
        mode: 'columns',
      })),
      log: vi.fn(),
      ...overrides,
    };
    return { deps, result: syncExams({ ...deps, exams: settings }) };
  };

  it('lit l’image, enregistre les examens et l’empreinte de la source', async () => {
    const { deps, result } = run();
    const { exams, imageUrl, cached, mode } = await result;

    expect(deps.moodle.fetchExamCalendar).toHaveBeenCalledWith({
      niveau: 'A3',
      annee: '2026-2027',
    });
    expect(deps.readTable).toHaveBeenCalledWith(bytes);
    expect({ imageUrl, cached, mode }).toEqual({
      imageUrl: IMAGE_URL,
      cached: false,
      mode: 'columns',
    });
    expect(exams.map((exam) => exam.element)).toEqual(['Épreuve A', 'Épreuve B']);

    const [, , insert, upsert] = deps.pool.writes();
    expect(insert.text).toMatch(/^INSERT INTO examens /);
    expect(insert.params[3]).toEqual(exams.map((exam) => exam.id));
    expect(upsert.params).toEqual([
      'FISE Informatique',
      'A3',
      '2026-2027',
      sha256('2', '\n', bytes, '\n', ''),
      IMAGE_URL,
    ]);
  });

  it('même empreinte : relit la base, sans OCR ni écriture', async () => {
    const stored = [
      {
        id: 'abc',
        filiere: 'FISE Informatique',
        niveau: 'A3',
        annee: '2026-2027',
        element: 'Épreuve en base',
        bloc: null,
        format: null,
        plateforme: null,
        session: null,
        date: '2026-11-05',
        debut: null,
        fin: null,
        a_verifier: [],
      },
    ];
    const pool = fakePool({
      source: { sourceHash: sha256('2', '\n', bytes, '\n', ''), imageUrl: IMAGE_URL },
      stored,
    });
    const { deps, result } = run({ pool });
    const outcome = await result;

    expect(deps.readTable).not.toHaveBeenCalled();
    expect(pool.writes()).toEqual([]);
    expect(outcome).toMatchObject({ cached: true, mode: null, imageUrl: IMAGE_URL });
    expect(outcome.exams.map((exam) => exam.element)).toEqual(['Épreuve en base']);
  });

  it('le fichier de corrections change l’empreinte : l’OCR est relancé et la correction appliquée', async () => {
    const text = JSON.stringify([
      { match: { element: 'Épreuve A' }, set: { date: '2026-12-01' } },
      { match: { element: 'Épreuve absente' }, remove: true },
    ]);
    await writeFile(settings.correctionsFile, text);
    // La base connaît l'empreinte de la même image sans corrections.
    const pool = fakePool({
      source: { sourceHash: sha256('2', '\n', bytes, '\n', ''), imageUrl: IMAGE_URL },
    });
    const { deps, result } = run({ pool });
    const { exams, cached } = await result;

    expect(cached).toBe(false);
    expect(deps.readTable).toHaveBeenCalledOnce();
    expect(exams.map((exam) => [exam.element, exam.date])).toEqual([
      ['Épreuve B', '2026-11-05'],
      ['Épreuve A', '2026-12-01'],
    ]);
    expect(pool.writes().at(-2).params[3]).toBe(sha256('2', '\n', bytes, '\n', text));
    expect(deps.log).toHaveBeenCalledWith('  Correction sans correspondance : Épreuve absente');
  });

  it('une image différente change l’empreinte', async () => {
    const moodle = fakeMoodle();
    moodle.fetchExamCalendar.mockResolvedValue({
      bytes: Buffer.from('autre image'),
      url: IMAGE_URL,
    });
    const pool = fakePool({
      source: { sourceHash: sha256('1', '\n', bytes, '\n', ''), imageUrl: IMAGE_URL },
    });
    const { deps, result } = run({ moodle, pool });
    expect((await result).cached).toBe(false);
    expect(deps.readTable).toHaveBeenCalledOnce();
  });

  it('zéro examen après filtrage : ExamError, la base n’est pas écrasée', async () => {
    const readTable = vi.fn(async () => ({
      rows: [row('Épreuve A', { formation: 'FISA Informatique A3' })],
      mode: 'fallback',
    }));
    const { deps, result } = run({ readTable });
    const error = await result.catch((caught) => caught);

    expect(error).toBeInstanceOf(ExamError);
    expect(error.message).toContain('aucun examen lu pour FISE Informatique A3');
    expect(error.message).toContain('base inchangée');
    expect(deps.pool.writes()).toEqual([]);
  });

  it('OCR sans aucune ligne : ExamError, même si des corrections ajoutent un examen', async () => {
    await writeFile(
      settings.correctionsFile,
      JSON.stringify([{ add: { element: 'Soutenance', date: '2026-12-18' } }]),
    );
    const { deps, result } = run({
      readTable: vi.fn(async () => ({ rows: [], mode: 'fallback' })),
    });
    await expect(result).rejects.toThrow(ExamError);
    expect(deps.pool.writes()).toEqual([]);
  });

  it('journalise le nombre d’examens, le mode et chaque examen à vérifier', async () => {
    const readTable = vi.fn(async () => ({
      rows: [
        row('Épreuve A'),
        row('Épreuve B', { fin: '11h65' }),
        row('Épreuve C', { date: '32/13/2026' }),
      ],
      mode: 'columns',
    }));
    const { deps, result } = run({ readTable });
    await result;
    expect(deps.log.mock.calls.map(([line]) => line)).toEqual([
      'Examens : 3 examen(s) pour 3 ligne(s) lue(s), mode columns.',
      '  À vérifier (horaire) : Épreuve B, 2026-11-05',
      '  À vérifier (date) : Épreuve C, 2026-11-05',
    ]);
  });

  it('signale la lecture dégradée du repli', async () => {
    const readTable = vi.fn(async () => ({
      rows: [row('Épreuve A', { flags: ['date', 'horaire'] })],
      mode: 'fallback',
    }));
    const { deps, result } = run({ readTable });
    expect((await result).mode).toBe('fallback');
    expect(deps.log.mock.calls[0][0]).toContain('mode fallback (lecture dégradée');
  });

  it('fichier de corrections invalide : ExamError avant tout accès à Moodle', async () => {
    await writeFile(settings.correctionsFile, '{ pas du json');
    const { deps, result } = run();
    await expect(result).rejects.toThrow(ExamError);
    expect(deps.moodle.fetchExamCalendar).not.toHaveBeenCalled();
    expect(deps.readTable).not.toHaveBeenCalled();
  });

  it('laisse remonter une erreur Moodle ou OCR sans toucher à la base', async () => {
    const readTable = vi.fn(async () => {
      throw new Error('OCR en panne');
    });
    const { deps, result } = run({ readTable });
    await expect(result).rejects.toThrow('OCR en panne');
    expect(deps.pool.writes()).toEqual([]);
  });
});

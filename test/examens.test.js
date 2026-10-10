import { describe, expect, it } from 'vitest';
import { getExamSource, listExams, replaceExams } from '../src/db/examens.js';

const scope = { filiere: 'FISE Informatique', niveau: 'A3', annee: '2026-2027' };
const exam = (id, extra = {}) => ({
  id,
  element: `Épreuve ${id}`,
  bloc: 'Bloc 1',
  format: 'QCM',
  plateforme: null,
  session: 'S1',
  date: '2026-11-03',
  debut: '09:00',
  fin: null,
  aVerifier: [],
  ...extra,
});

// Faux pool pg : journalise chaque requête (début du texte) et ses paramètres ; peut échouer sur un préfixe.
function fakePool({ failOn = null, rows = [] } = {}) {
  const log = [];
  const calls = [];
  const client = {
    async query(sql, params) {
      const text = String(sql).trim().replace(/\s+/g, ' ');
      log.push(text.split(' ').slice(0, 3).join(' '));
      calls.push({ text, params });
      if (failOn && text.startsWith(failOn)) throw new Error('échec');
      return { rows, rowCount: rows.length };
    },
    release() {},
  };
  return { log, calls, query: client.query, connect: async () => client };
}

describe('replaceExams', () => {
  it('supprime, insère en bloc, upsert la source puis valide', async () => {
    const pool = fakePool();
    await replaceExams(pool, scope, [exam('a'), exam('b', { aVerifier: ['date'] })], {
      sourceHash: 'h1',
      imageUrl: 'https://moodle.cesi.fr/img.png',
    });

    expect(pool.log).toEqual([
      'BEGIN',
      'DELETE FROM examens',
      'INSERT INTO examens',
      'INSERT INTO examens_sources',
      'COMMIT',
    ]);
    const insert = pool.calls[2].params;
    expect(insert.slice(0, 3)).toEqual(['FISE Informatique', 'A3', '2026-2027']);
    expect(insert[3]).toEqual(['a', 'b']);
    expect(insert[12]).toEqual(['{}', '{"date"}']);
    expect(insert[13]).toEqual([0, 1]);
    expect(pool.calls[3].params).toEqual([
      ...Object.values(scope),
      'h1',
      'https://moodle.cesi.fr/img.png',
    ]);
  });

  it('sans examen, ne fait que supprimer puis mémoriser la source', async () => {
    const pool = fakePool();
    await replaceExams(pool, scope, [], { sourceHash: 'h2' });

    expect(pool.log).toEqual([
      'BEGIN',
      'DELETE FROM examens',
      'INSERT INTO examens_sources',
      'COMMIT',
    ]);
    expect(pool.calls[2].params[4]).toBeNull();
  });

  it('annule la transaction et propage l’erreur', async () => {
    const pool = fakePool({ failOn: 'INSERT INTO examens_sources' });
    await expect(replaceExams(pool, scope, [exam('a')], { sourceHash: 'h' })).rejects.toThrow(
      'échec',
    );

    expect(pool.log).toContain('ROLLBACK');
    expect(pool.log).not.toContain('COMMIT');
  });
});

describe('listExams', () => {
  it('renvoie des objets camelCase dans l’ordre de la requête', async () => {
    const pool = fakePool({
      rows: [
        {
          id: 'a',
          filiere: scope.filiere,
          niveau: 'A3',
          annee: scope.annee,
          element: 'E',
          bloc: null,
          format: null,
          plateforme: null,
          session: null,
          date: '2026-11-03',
          debut: '09:00',
          fin: null,
          a_verifier: ['date'],
        },
      ],
    });
    const [result] = await listExams(pool, scope);

    expect(result).toMatchObject({ id: 'a', date: '2026-11-03', debut: '09:00', fin: null });
    expect(result.aVerifier).toEqual(['date']);
    expect(pool.calls[0].text).toMatch(/ORDER BY position$/);
    expect(pool.calls[0].text).toMatch(/to_char\(jour, 'YYYY-MM-DD'\)/);
  });
});

describe('getExamSource', () => {
  it('renvoie null sans source, sinon empreinte et image', async () => {
    expect(await getExamSource(fakePool(), scope)).toBeNull();
    const pool = fakePool({ rows: [{ source_hash: 'h', image_url: 'u' }] });
    expect(await getExamSource(pool, scope)).toEqual({ sourceHash: 'h', imageUrl: 'u' });
  });
});

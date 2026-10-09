import { describe, expect, it } from 'vitest';
import { MIGRATIONS, runMigrations } from '../src/db/schema.js';

// Faux pool pg : mémorise les versions « appliquées » et journalise le début de chaque requête.
function fakePool(applied = [], failOn = null) {
  const versions = new Set(applied);
  const log = [];
  const client = {
    async query(sql, params) {
      const text = String(sql).trim();
      log.push(text.split(/\s+/).slice(0, 2).join(' '));
      if (failOn && text === failOn) throw new Error('échec');
      if (text.startsWith('SELECT 1 FROM schema_migrations')) {
        return { rowCount: versions.has(params[0]) ? 1 : 0 };
      }
      if (text.startsWith('INSERT INTO schema_migrations')) versions.add(params[0]);
      return { rowCount: 0 };
    },
    release() {},
  };
  return { versions, log, query: client.query, connect: async () => client };
}

describe('runMigrations', () => {
  it('applique les migrations dans l’ordre, chacune en transaction sous verrou', async () => {
    const pool = fakePool();
    await runMigrations(pool);

    expect([...pool.versions]).toEqual(MIGRATIONS.map((m) => m.version));
    expect(pool.log.filter((l) => l === 'BEGIN')).toHaveLength(2);
    expect(pool.log.filter((l) => l === 'COMMIT')).toHaveLength(2);
    expect(pool.log.filter((l) => l === 'SELECT pg_advisory_xact_lock($1)')).toHaveLength(2);
  });

  it('est idempotente : une 2e exécution ne rejoue rien', async () => {
    const pool = fakePool();
    await runMigrations(pool);
    pool.log.length = 0;
    await runMigrations(pool);

    expect(pool.log.some((l) => l.startsWith('INSERT'))).toBe(false);
    expect(pool.log.some((l) => l.startsWith('DROP'))).toBe(false);
  });

  it('ne rejoue pas une migration déjà appliquée', async () => {
    const pool = fakePool([1]);
    await runMigrations(pool);

    expect([...pool.versions].sort()).toEqual([1, 2]);
    expect(pool.log.filter((l) => l.startsWith('INSERT'))).toHaveLength(1);
  });

  it('annule la transaction et propage l’erreur si une migration échoue', async () => {
    const pool = fakePool([], 'BOOM');
    await expect(runMigrations(pool, [{ version: 1, sql: 'BOOM' }])).rejects.toThrow('échec');

    expect(pool.log).toContain('ROLLBACK');
    expect(pool.log).not.toContain('COMMIT');
    expect(pool.versions.size).toBe(0);
  });
});

import pg from 'pg';
import { SCHEMA_SQL } from './schema.js';

export function createPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 2 });
}

export async function applySchema(pool) {
  await pool.query(SCHEMA_SQL);
}

/**
 * Remplace les séances d'une personne sur une semaine (bornes `YYYY-MM-DD`, heure de Paris), en transaction :
 * les cours annulés ou déplacés disparaissent. Si un id existe déjà (déplacé dans une autre semaine), il est mis à jour.
 */
export async function replaceWeek(pool, codePersonne, range, seances) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM seances
       WHERE code_personne = $1
         AND debut >= ($2::date::timestamp AT TIME ZONE 'Europe/Paris')
         AND debut <  (($3::date + 1)::timestamp AT TIME ZONE 'Europe/Paris')`,
      [codePersonne, range.start, range.end],
    );
    for (const seance of seances) {
      await client.query(
        `INSERT INTO seances (id, code_personne, debut, fin, titre, matiere, module, salles, raw, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (id) DO UPDATE SET
           code_personne = EXCLUDED.code_personne,
           debut = EXCLUDED.debut,
           fin = EXCLUDED.fin,
           titre = EXCLUDED.titre,
           matiere = EXCLUDED.matiere,
           module = EXCLUDED.module,
           salles = EXCLUDED.salles,
           raw = EXCLUDED.raw,
           synced_at = EXCLUDED.synced_at`,
        [
          seance.id,
          seance.codePersonne,
          seance.debut,
          seance.fin,
          seance.titre,
          seance.matiere,
          seance.module,
          seance.salles,
          JSON.stringify(seance.raw),
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

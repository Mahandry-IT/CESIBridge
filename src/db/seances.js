import pg from 'pg';
import { runMigrations } from './schema.js';

export function createPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 2 });
}

export async function applySchema(pool) {
  await runMigrations(pool);
}

// Liaisons d'une séance : upsert des référentiels (intervenants, groupes) puis insertion multi-lignes via `unnest`.
async function insertLinks(client, seance) {
  const { code, salles, intervenants, groupes } = seance;
  if (salles.length > 0) {
    await client.query(
      `INSERT INTO seance_salles (seance_code, nom_salle) SELECT $1, unnest($2::text[])`,
      [code, salles],
    );
  }
  if (intervenants.length > 0) {
    await client.query(
      `INSERT INTO intervenants (code, nom, prenom, sous_titre, updated_at)
       SELECT t.*, now() FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS t
       ON CONFLICT (code) DO UPDATE SET
         nom = EXCLUDED.nom,
         prenom = EXCLUDED.prenom,
         sous_titre = EXCLUDED.sous_titre,
         updated_at = EXCLUDED.updated_at`,
      [
        intervenants.map((i) => i.code),
        intervenants.map((i) => i.nom),
        intervenants.map((i) => i.prenom),
        intervenants.map((i) => i.sousTitre),
      ],
    );
    await client.query(
      `INSERT INTO seance_intervenants (seance_code, intervenant_code)
       SELECT $1, unnest($2::text[])`,
      [code, intervenants.map((i) => i.code)],
    );
  }
  if (groupes.length > 0) {
    await client.query(
      `INSERT INTO groupes (code, libelle, updated_at)
       SELECT t.*, now() FROM unnest($1::text[], $2::text[]) AS t
       ON CONFLICT (code) DO UPDATE SET
         libelle = EXCLUDED.libelle,
         updated_at = EXCLUDED.updated_at`,
      [groupes.map((g) => g.code), groupes.map((g) => g.libelle)],
    );
    await client.query(
      `INSERT INTO seance_groupes (seance_code, code_groupe, code_session)
       SELECT $1, t.* FROM unnest($2::text[], $3::text[]) AS t`,
      [code, groupes.map((g) => g.code), groupes.map((g) => g.codeSession)],
    );
  }
}

const LINK_TABLES = ['seance_salles', 'seance_intervenants', 'seance_groupes'];

/**
 * Remplace les séances d'une personne sur une semaine (bornes `YYYY-MM-DD`, heure de Paris), en transaction :
 * les cours annulés ou déplacés disparaissent (la cascade supprime leurs liaisons). Si un code existe déjà
 * (séance déplacée depuis une autre semaine), la séance est mise à jour et ses liaisons sont recréées.
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
        `INSERT INTO seances
           (code, code_personne, titre, matiere, module, theme, debut, fin, all_day, nightly, url, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         ON CONFLICT (code) DO UPDATE SET
           code_personne = EXCLUDED.code_personne,
           titre = EXCLUDED.titre,
           matiere = EXCLUDED.matiere,
           module = EXCLUDED.module,
           theme = EXCLUDED.theme,
           debut = EXCLUDED.debut,
           fin = EXCLUDED.fin,
           all_day = EXCLUDED.all_day,
           nightly = EXCLUDED.nightly,
           url = EXCLUDED.url,
           synced_at = EXCLUDED.synced_at`,
        [
          seance.code,
          seance.codePersonne,
          seance.titre,
          seance.matiere,
          seance.module,
          seance.theme,
          seance.debut,
          seance.fin,
          seance.allDay,
          seance.nightly,
          seance.url,
        ],
      );
      // Liaisons d'une séance déjà présente hors de la fenêtre : on repart de zéro.
      for (const table of LINK_TABLES) {
        await client.query(`DELETE FROM ${table} WHERE seance_code = $1`, [seance.code]);
      }
      await insertLinks(client, seance);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

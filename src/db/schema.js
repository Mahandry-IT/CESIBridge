// Migrations versionnées, appliquées dans l'ordre, une seule fois chacune (table `schema_migrations`).
export const MIGRATIONS = [
  {
    version: 1,
    // Ancienne table : identique à l'existante, pour les bases neuves comme pour les bases déjà en place.
    sql: `
CREATE TABLE IF NOT EXISTS seances (
  id            text PRIMARY KEY,
  code_personne text NOT NULL,
  debut         timestamptz NOT NULL,
  fin           timestamptz NOT NULL,
  titre         text,
  matiere       text,
  module        text,
  salles        text,
  raw           jsonb NOT NULL,
  synced_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seances_personne_debut_idx ON seances (code_personne, debut);
ALTER TABLE seances ADD COLUMN IF NOT EXISTS matiere text;
ALTER TABLE seances ADD COLUMN IF NOT EXISTS module text;
ALTER TABLE seances ADD COLUMN IF NOT EXISTS salles text;
`,
  },
  {
    version: 2,
    // Schéma relationnel sans JSON. Les données sont re-synchronisables : on supprime l'ancienne table
    // plutôt que de la convertir (le `raw` ne permet pas de reconstituer les liaisons proprement).
    sql: `
DROP TABLE IF EXISTS seances;
CREATE TABLE seances (
  code          text PRIMARY KEY,
  code_personne text NOT NULL,
  titre         text,
  matiere       text,
  module        text,
  theme         text,
  debut         timestamptz NOT NULL,
  fin           timestamptz NOT NULL,
  all_day       boolean NOT NULL DEFAULT false,
  nightly       boolean NOT NULL DEFAULT false,
  url           text,
  synced_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seances_personne_debut_idx ON seances (code_personne, debut);
CREATE TABLE seance_salles (
  seance_code text NOT NULL REFERENCES seances(code) ON DELETE CASCADE,
  nom_salle   text NOT NULL,
  PRIMARY KEY (seance_code, nom_salle)
);
CREATE TABLE intervenants (
  code       text PRIMARY KEY,
  nom        text,
  prenom     text,
  sous_titre text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE seance_intervenants (
  seance_code      text NOT NULL REFERENCES seances(code) ON DELETE CASCADE,
  intervenant_code text NOT NULL REFERENCES intervenants(code),
  PRIMARY KEY (seance_code, intervenant_code)
);
CREATE TABLE groupes (
  code       text PRIMARY KEY,
  libelle    text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE seance_groupes (
  seance_code  text NOT NULL REFERENCES seances(code) ON DELETE CASCADE,
  code_groupe  text NOT NULL REFERENCES groupes(code),
  code_session text,
  PRIMARY KEY (seance_code, code_groupe)
);
`,
  },
];

// Clé du verrou consultatif propre à l'application (évite deux synchros concurrentes pendant les migrations).
const LOCK_KEY = 727001;

/**
 * Applique les migrations manquantes. Chacune s'exécute dans sa propre transaction, sous verrou consultatif ;
 * les versions déjà appliquées sont relues sous verrou, donc un second processus ne rejoue rien.
 */
export async function runMigrations(pool, migrations = MIGRATIONS) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    int PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  for (const { version, sql } of migrations) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [
        version,
      ]);
      if (done.rowCount === 0) {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

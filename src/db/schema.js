export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS seances (
  id            text PRIMARY KEY,
  code_personne text NOT NULL,
  debut         timestamptz NOT NULL,
  fin           timestamptz NOT NULL,
  titre         text,
  raw           jsonb NOT NULL,
  synced_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seances_personne_debut_idx ON seances (code_personne, debut);
-- Colonnes ajoutées après la première version : ALTER idempotent pour les bases existantes.
ALTER TABLE seances ADD COLUMN IF NOT EXISTS matiere text;
ALTER TABLE seances ADD COLUMN IF NOT EXISTS module text;
ALTER TABLE seances ADD COLUMN IF NOT EXISTS salles text;
`;

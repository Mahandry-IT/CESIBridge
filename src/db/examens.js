// Examens d'un périmètre `{ filiere, niveau, annee }` : remplacés en bloc à chaque lecture du tableau source.
const EXAM_COLUMNS = [
  'id',
  'element',
  'bloc',
  'format',
  'plateforme',
  'session',
  'date',
  'debut',
  'fin',
];

/**
 * Remplace les examens d'un périmètre et mémorise la source (empreinte, image), en une transaction.
 * `position` conserve l'ordre du tableau source.
 */
export async function replaceExams(pool, scope, exams, { sourceHash, imageUrl }) {
  const { filiere, niveau, annee } = scope;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM examens WHERE filiere = $1 AND niveau = $2 AND annee = $3', [
      filiere,
      niveau,
      annee,
    ]);
    if (exams.length > 0) {
      const [ids, elements, blocs, formats, plateformes, sessions, dates, debuts, fins] =
        EXAM_COLUMNS.map((column) => exams.map((exam) => exam[column] ?? null));
      await client.query(
        `INSERT INTO examens
           (id, filiere, niveau, annee, element, bloc, format, plateforme, session,
            jour, debut, fin, a_verifier, position)
         SELECT t.id, $1, $2, $3, t.element, t.bloc, t.format, t.plateforme, t.session,
                t.jour::date, t.debut::time, t.fin::time, t.a_verifier::text[], t.position
         FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[],
                     $10::text[], $11::text[], $12::text[], $13::text[], $14::int[])
              AS t(id, element, bloc, format, plateforme, session, jour, debut, fin, a_verifier, position)`,
        [
          filiere,
          niveau,
          annee,
          ids,
          elements,
          blocs,
          formats,
          plateformes,
          sessions,
          dates,
          debuts,
          fins,
          // Tableau de tableaux impossible via unnest : chaque liste est sérialisée en littéral PostgreSQL.
          exams.map((exam) => toArrayLiteral(exam.aVerifier ?? [])),
          exams.map((_exam, index) => index),
        ],
      );
    }
    await client.query(
      `INSERT INTO examens_sources (filiere, niveau, annee, source_hash, image_url, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (filiere, niveau, annee) DO UPDATE SET
         source_hash = EXCLUDED.source_hash,
         image_url = EXCLUDED.image_url,
         updated_at = EXCLUDED.updated_at`,
      [filiere, niveau, annee, sourceHash, imageUrl ?? null],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function toArrayLiteral(values) {
  const quoted = values.map((value) => {
    const escaped = String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    return `"${escaped}"`;
  });
  return `{${quoted.join(',')}}`;
}

/** Examens d'un périmètre dans l'ordre du tableau source. Dates `YYYY-MM-DD`, heures `HH:MM` ou `null`. */
export async function listExams(pool, scope) {
  const { rows } = await pool.query(
    `SELECT id, filiere, niveau, annee, element, bloc, format, plateforme, session,
            to_char(jour, 'YYYY-MM-DD') AS date,
            to_char(debut, 'HH24:MI') AS debut,
            to_char(fin, 'HH24:MI') AS fin,
            a_verifier
     FROM examens
     WHERE filiere = $1 AND niveau = $2 AND annee = $3
     ORDER BY position`,
    [scope.filiere, scope.niveau, scope.annee],
  );
  return rows.map((row) => ({
    id: row.id,
    filiere: row.filiere,
    niveau: row.niveau,
    annee: row.annee,
    element: row.element,
    bloc: row.bloc,
    format: row.format,
    plateforme: row.plateforme,
    session: row.session,
    date: row.date,
    debut: row.debut,
    fin: row.fin,
    aVerifier: row.a_verifier,
  }));
}

/** Empreinte et image de la dernière source lue pour ce périmètre, ou `null`. */
export async function getExamSource(pool, scope) {
  const { rows } = await pool.query(
    `SELECT source_hash, image_url FROM examens_sources
     WHERE filiere = $1 AND niveau = $2 AND annee = $3`,
    [scope.filiere, scope.niveau, scope.annee],
  );
  if (rows.length === 0) return null;
  return { sourceHash: rows[0].source_hash, imageUrl: rows[0].image_url };
}

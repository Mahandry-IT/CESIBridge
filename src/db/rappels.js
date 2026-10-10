// Rappels d'examen déjà envoyés par e-mail : un par (examen, seuil en jours, date de l'examen).

/** Rappels envoyés parmi ces examens : `[{ examId, jours, date: 'YYYY-MM-DD' }]`. */
export async function listSentReminders(pool, examIds) {
  if (examIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT exam_id, jours, to_char(jour, 'YYYY-MM-DD') AS date
     FROM examens_rappels
     WHERE exam_id = ANY($1::text[])`,
    [examIds],
  );
  return rows.map((row) => ({ examId: row.exam_id, jours: row.jours, date: row.date }));
}

/** Marque ces rappels comme envoyés (insertion groupée, idempotente). */
export async function markRemindersSent(pool, reminders) {
  if (reminders.length === 0) return;
  await pool.query(
    `INSERT INTO examens_rappels (exam_id, jours, jour)
     SELECT * FROM unnest($1::text[], $2::int[], $3::date[])
     ON CONFLICT DO NOTHING`,
    [
      reminders.map((reminder) => reminder.examId),
      reminders.map((reminder) => reminder.jours),
      reminders.map((reminder) => reminder.date),
    ],
  );
}

// Republie les N semaines et le calendrier des examens depuis la base vers Google Calendar,
// sans ENT, ni navigateur, ni OCR.
import { loadPublishConfig } from '../src/config.js';
import { getExamSource, listExams } from '../src/db/examens.js';
import { applySchema, createPool, listCodesPersonne, listWeek } from '../src/db/seances.js';
import { publishExams } from '../src/exams/publish.js';
import { createTokenProvider } from '../src/google/auth.js';
import { createCalendarClient } from '../src/google/client.js';
import { formatCounts, publishWeek } from '../src/google/publish.js';
import { weekRanges } from '../src/schedule/weeks.js';
import { log } from '../src/log.js';

let config;
try {
  config = loadPublishConfig();
} catch (error) {
  log(error.message);
  process.exit(1);
}

async function resolveCodePersonne(pool) {
  if (config.codePersonne) return config.codePersonne;
  const codes = await listCodesPersonne(pool);
  if (codes.length === 0) {
    throw new Error('Base vide : lancer `npm run sync` d’abord (ou définir CESI_CODE_PERSONNE).');
  }
  if (codes.length > 1) {
    throw new Error(
      `${codes.length} codes personne en base : définir CESI_CODE_PERSONNE pour choisir.`,
    );
  }
  return codes[0];
}

// Les examens viennent de la dernière lecture enregistrée par `npm run sync`.
async function publishExamCalendar(pool, client) {
  const { filiere, niveau, annee } = config.exams;
  const scope = { filiere, niveau, annee };
  const source = await getExamSource(pool, scope);
  // Jamais lus : publier une liste vide effacerait des examens sans raison.
  if (!source) return `Examens ${annee} : aucun en base (lancer \`npm run sync\`)`;
  const exams = await listExams(pool, scope);
  const counts = await publishExams(client, annee, exams, { imageUrl: source.imageUrl });
  return `Examens ${annee} : ${exams.length} examen(s), ${formatCounts(counts)}`;
}

let pool;
let exitCode = 0;
try {
  pool = createPool(config.databaseUrl);
  await applySchema(pool);
  const codePersonne = await resolveCodePersonne(pool);
  const client = createCalendarClient({
    calendarId: config.google.calendarId,
    getToken: createTokenProvider(config.google.keyFile),
  });
  const summary = [];
  for (const range of weekRanges(new Date(), config.scheduleWeeks)) {
    const seances = await listWeek(pool, codePersonne, range);
    const counts = await publishWeek(client, range, seances);
    summary.push(
      `${range.start} → ${range.end} : ${seances.length} séance(s), ${formatCounts(counts)}`,
    );
  }
  log(`Publication terminée :\n  ${summary.join('\n  ')}`);
  if (config.exams) log(await publishExamCalendar(pool, client));
} catch (error) {
  exitCode = 1;
  log(`Échec de la publication : ${error.message}`);
} finally {
  await pool?.end();
}
// exitCode plutôt que exit() : laisse se fermer les sockets fetch (sinon assertion libuv sous Windows).
process.exitCode = exitCode;

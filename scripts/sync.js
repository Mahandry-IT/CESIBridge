// Synchronise l'emploi du temps CESI (N semaines) vers PostgreSQL, puis le calendrier des examens.
// Réutilise le storageState ; se reconnecte automatiquement (un seul essai) si la session a expiré.
import { loadSyncConfig } from '../src/config.js';
import { launchBrowser } from '../src/browser/session.js';
import { createSessionManager } from '../src/browser/sessionManager.js';
import { discoverCodePersonne } from '../src/schedule/codePersonne.js';
import { fetchWeekWithRetry } from '../src/schedule/client.js';
import { mapSeance } from '../src/schedule/mapping.js';
import { weekRanges } from '../src/schedule/weeks.js';
import { applySchema, createPool, listWeek, replaceWeek } from '../src/db/seances.js';
import { createTokenProvider } from '../src/google/auth.js';
import { createCalendarClient } from '../src/google/client.js';
import { formatCounts, publishWeek } from '../src/google/publish.js';
import { publishExams } from '../src/exams/publish.js';
import { syncExams } from '../src/exams/sync.js';
import { createMoodleService } from '../src/moodle/service.js';
import { log } from '../src/log.js';

let config;
try {
  config = loadSyncConfig();
} catch (error) {
  log(error.message);
  process.exit(1);
}

let browser;
const sessions = createSessionManager({
  getBrowser: async () => (browser ??= await launchBrowser({ headless: config.headless })),
  config,
  credentials: config.credentials,
});

// Google facultatif : une erreur n'annule pas la base, mais arrête les publications suivantes.
const calendar = config.google
  ? createCalendarClient({
      calendarId: config.google.calendarId,
      getToken: createTokenProvider(config.google.keyFile),
    })
  : null;
let googleFailure = null;

async function publishToGoogle(codePersonne, range) {
  if (!calendar) return '';
  if (googleFailure) return ', Google non publié';
  try {
    const counts = await publishWeek(calendar, range, await listWeek(pool, codePersonne, range));
    return `, ${formatCounts(counts)}`;
  } catch (error) {
    googleFailure = error.message;
    return ', Google échec';
  }
}

const describe = (error) => (error.name === 'TimeoutError' ? 'délai dépassé' : error.message);

// Le service Moodle ouvre son propre contexte de session, dans le navigateur déjà lancé.
async function syncExamCalendar() {
  const { annee, reminderDays } = config.exams;
  const moodle = createMoodleService({ sessions, config });
  const { exams, imageUrl, cached } = await syncExams({ moodle, pool, exams: config.exams, log });
  const summary = `Examens ${annee} : ${exams.length} examen(s)${cached ? ' (inchangés)' : ''}`;
  if (!calendar) return summary;
  if (googleFailure) return `${summary}, Google non publié`;
  try {
    const counts = await publishExams(calendar, annee, exams, { reminderDays, imageUrl });
    return `${summary}, ${formatCounts(counts)}`;
  } catch (error) {
    googleFailure = error.message;
    return `${summary}, Google échec`;
  }
}

let pool;
let exitCode = 0;
try {
  pool = createPool(config.databaseUrl);
  await applySchema(pool);

  const summary = await sessions.withContext(async (session) => {
    const codePersonne =
      config.codePersonne ??
      (await discoverCodePersonne(session.page, {
        entUrl: config.entUrl,
        timeoutMs: config.navTimeoutMs,
      }));

    const lines = [];
    for (const range of weekRanges(new Date(), config.scheduleWeeks)) {
      const raws = await fetchWeekWithRetry(
        session.context.request,
        {
          entUrl: config.entUrl,
          loggedInHosts: config.loggedInHosts,
          codePersonne,
          range,
        },
        // La reconnexion crée un nouveau contexte : le nouvel essai utilise son `request`.
        async () => (await session.renew()).request,
      );
      const seances = raws.map((raw) => mapSeance(raw, codePersonne));
      await replaceWeek(pool, codePersonne, range, seances);
      const google = await publishToGoogle(codePersonne, range);
      lines.push(`${range.start} → ${range.end} : ${seances.length} séance(s)${google}`);
    }
    return lines;
  });
  log(`Synchronisation terminée :\n  ${summary.join('\n  ')}`);
  if (config.exams) {
    // Étape indépendante : son échec ne remet pas en cause les séances déjà synchronisées.
    try {
      log(await syncExamCalendar());
    } catch (error) {
      exitCode = 1;
      log(`Échec du calendrier des examens (séances à jour) : ${describe(error)}`);
    }
  }
  if (googleFailure) {
    exitCode = 1;
    log(
      `Publication Google interrompue (base à jour) : ${googleFailure}. Relancer avec "npm run publish".`,
    );
  }
} catch (error) {
  exitCode = 1;
  log(`Échec de la synchronisation : ${describe(error)}`);
} finally {
  await browser?.close();
  await pool?.end();
}
// exitCode plutôt que exit() : laisse se fermer les sockets fetch (sinon assertion libuv sous Windows).
process.exitCode = exitCode;

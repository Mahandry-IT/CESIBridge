import { createMoodleClient } from './client.js';
import { MOODLE_HOST } from './constants.js';
import { downloadResource, fetchResourceBytes, validateDownloadUrl } from './download.js';
import { selectExamCalendarActivity, selectSessionCourse } from './examCalendar.js';
import { mapCourses, mapCourseState, mapEvents } from './mappers.js';
import { openMoodle } from './open.js';
import { extractScholarvoxBooks } from '../scholarvox/docid.js';

const SECONDS_PER_DAY = 86_400;
// Échéances dépassées encore actionnables (non rendues) : remontées sur 7 jours.
const OVERDUE_LOOKBACK_DAYS = 7;
// Maximum accepté par core_calendar_get_action_events_by_timesort.
const EVENTS_LIMIT = 50;
const SCHOLARVOX_LINKS = 'a[href*="univ.scholarvox.com/reader/docid/"]';

/**
 * Accès Moodle en lecture seule, au-dessus du gestionnaire de session.
 * L'URL d'accès découverte sur l'ENT est mémorisée pour les appels suivants.
 */
export function createMoodleService({ sessions, config, fetch = globalThis.fetch }) {
  let accessUrl = config.moodleUrl;

  function withMoodle(fn) {
    return sessions.withContext(async (session) => {
      let page = null;
      const open = async () => {
        await page?.close().catch(() => {});
        const opened = await openMoodle(session.context, {
          moodleUrl: accessUrl,
          entUrl: config.entUrl,
          navTimeoutMs: config.navTimeoutMs,
          loginTimeoutMs: config.loginTimeoutMs,
          credentials: config.credentials,
        });
        accessUrl = opened.accessUrl;
        page = opened.page;
        return { sesskey: opened.sesskey, wwwroot: opened.wwwroot };
      };
      const client = createMoodleClient({ request: session.context.request, open });
      return fn({ client, context: session.context, page: () => page });
    });
  }

  async function fetchCourses(client) {
    return mapCourses(
      await client.call('core_course_get_enrolled_courses_by_timeline_classification', {
        classification: 'all',
        limit: 0,
        offset: 0,
        sort: 'fullname',
      }),
    );
  }

  function listCourses() {
    return withMoodle(({ client }) => fetchCourses(client));
  }

  function upcomingDeadlines(days, now = new Date()) {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    return withMoodle(async ({ client }) =>
      mapEvents(
        await client.call('core_calendar_get_action_events_by_timesort', {
          timesortfrom: nowSeconds - OVERDUE_LOOKBACK_DAYS * SECONDS_PER_DAY,
          timesortto: nowSeconds + days * SECONDS_PER_DAY,
          limitnum: EVENTS_LIMIT,
        }),
        now,
      ),
    );
  }

  // Les liens Scholarvox sont dans le HTML du cours (blocs « Zone texte et média »).
  async function readScholarvoxBooks(page, wwwroot, courseId) {
    const url = new URL('/course/view.php', wwwroot);
    url.searchParams.set('id', String(courseId));
    // Liens rendus côté serveur : inutile d'attendre les images et scripts de la page.
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: config.navTimeoutMs });
    const links = await page
      .locator(SCHOLARVOX_LINKS)
      .evaluateAll((anchors) => anchors.map((a) => ({ href: a.href, text: a.textContent })));
    return extractScholarvoxBooks(links);
  }

  function getCourse(courseId) {
    return withMoodle(async ({ client, page }) => {
      const sections = mapCourseState(
        await client.call('core_courseformat_get_state', { courseid: courseId }),
      );
      const course = (await fetchCourses(client)).find((item) => item.id === courseId);
      const { wwwroot } = await client.ensureOpen();
      const scholarvoxBooks = await readScholarvoxBooks(page(), wwwroot, courseId);
      return { id: courseId, name: course?.name ?? null, sections, scholarvoxBooks };
    });
  }

  function download(url) {
    // Validation avant toute ouverture de navigateur.
    validateDownloadUrl(url);
    return withMoodle(async ({ client, context }) => {
      await client.ensureOpen();
      const cookies = await context.cookies(`https://${MOODLE_HOST}/`);
      const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
      return downloadResource({
        url,
        cookieHeader,
        dir: config.downloadDir,
        maxBytes: config.downloadMaxBytes,
        fetch,
      });
    });
  }

  function fetchExamCalendar({ niveau, annee }) {
    return withMoodle(async ({ client, context }) => {
      const courses = await fetchCourses(client);
      const course = selectSessionCourse(courses, { niveau, annee });
      const sections = mapCourseState(
        await client.call('core_courseformat_get_state', { courseid: course.id }),
      );
      const activity = selectExamCalendarActivity(sections);
      await client.ensureOpen();
      const cookies = await context.cookies(`https://${MOODLE_HOST}/`);
      const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
      const { bytes, contentType } = await fetchResourceBytes({
        url: activity.url,
        cookieHeader,
        maxBytes: config.downloadMaxBytes,
        fetch,
        accept: (mime) => mime.startsWith('image/'),
      });
      return {
        bytes,
        contentType,
        url: activity.url,
        courseId: course.id,
        courseName: course.name,
        // Pour rattacher chaque examen à son cours.
        courses: courses.map(({ name, url }) => ({ name, url })),
      };
    });
  }

  return { listCourses, upcomingDeadlines, getCourse, download, fetchExamCalendar };
}

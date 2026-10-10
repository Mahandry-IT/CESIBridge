import { z } from 'zod';
import { isMoodleUrl } from './constants.js';
import { toParisIso } from './dates.js';
import { MoodleError } from './errors.js';
import { truncate } from '../text.js';

export const MAX_COURSES = 200;
export const MAX_EVENTS = 100;
export const MAX_SECTIONS = 100;
export const MAX_ACTIVITIES_PER_SECTION = 100;

// Liens renvoyés à l'outil : uniquement sur l'hôte Moodle (contenu tiers non fiable).
function moodleUrlOrNull(value) {
  return typeof value === 'string' && isMoodleUrl(value) ? value : null;
}

function parseOrThrow(schema, data, what) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new MoodleError(`réponse Moodle inattendue (${what})`);
  return parsed.data;
}

const courseSchema = z.looseObject({
  id: z.number().int().positive(),
  fullname: z.string(),
  shortname: z.string().optional(),
  coursecategory: z.string().optional(),
  viewurl: z.string().optional(),
  startdate: z.number().optional(),
  enddate: z.number().optional(),
  progress: z.number().nullable().optional(),
  hasprogress: z.boolean().optional(),
});
const coursesSchema = z.looseObject({ courses: z.array(courseSchema) });

/** `core_course_get_enrolled_courses_by_timeline_classification` → cours simplifiés. */
export function mapCourses(data) {
  const { courses } = parseOrThrow(coursesSchema, data, 'cours');
  return courses.slice(0, MAX_COURSES).map((course) => ({
    id: course.id,
    name: truncate(course.fullname),
    shortName: truncate(course.shortname),
    category: truncate(course.coursecategory),
    url: moodleUrlOrNull(course.viewurl),
    startDate: toParisIso(course.startdate),
    endDate: toParisIso(course.enddate),
    progress:
      course.hasprogress !== false && Number.isFinite(course.progress)
        ? Math.round(course.progress)
        : null,
  }));
}

const eventSchema = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  activityname: z.string().nullable().optional(),
  modulename: z.string().nullable().optional(),
  timesort: z.number(),
  url: z.string().optional(),
  overdue: z.boolean().optional(),
  course: z.looseObject({ id: z.number().int(), fullname: z.string() }).optional(),
});
const eventsSchema = z.looseObject({ events: z.array(eventSchema) });

/** `core_calendar_get_action_events_by_timesort` → échéances triées. */
export function mapEvents(data, now = new Date()) {
  const { events } = parseOrThrow(eventsSchema, data, 'échéances');
  const nowSeconds = Math.floor(now.getTime() / 1000);
  return [...events]
    .sort((a, b) => a.timesort - b.timesort)
    .slice(0, MAX_EVENTS)
    .map((event) => ({
      courseId: event.course?.id ?? null,
      courseName: truncate(event.course?.fullname),
      name: truncate(event.activityname || event.name),
      type: truncate(event.modulename, 50),
      due: toParisIso(event.timesort),
      url: moodleUrlOrNull(event.url),
      overdue: event.overdue ?? event.timesort < nowSeconds,
    }));
}

const stateSchema = z.looseObject({
  section: z.array(
    z.looseObject({
      id: z.coerce.number().int(),
      title: z.string().optional(),
      cmlist: z.array(z.coerce.number().int()).optional(),
      visible: z.boolean().optional(),
    }),
  ),
  cm: z.array(
    z.looseObject({
      id: z.coerce.number().int(),
      name: z.string().optional(),
      module: z.string().optional(),
      modname: z.string().optional(),
      url: z.string().optional(),
      visible: z.boolean().optional(),
      uservisible: z.boolean().optional(),
    }),
  ),
});

function isVisible(item) {
  return item.uservisible !== false && item.visible !== false;
}

/** `core_courseformat_get_state` (chaîne JSON) → sections et activités visibles. */
export function mapCourseState(data) {
  if (typeof data !== 'string') throw new MoodleError('réponse Moodle inattendue (cours)');
  let json;
  try {
    json = JSON.parse(data);
  } catch {
    throw new MoodleError('réponse Moodle inattendue (cours)');
  }
  const state = parseOrThrow(stateSchema, json, 'cours');
  const cms = new Map(state.cm.filter(isVisible).map((cm) => [cm.id, cm]));
  return state.section
    .filter((section) => section.visible !== false)
    .slice(0, MAX_SECTIONS)
    .map((section) => ({
      id: section.id,
      name: truncate(section.title),
      activities: (section.cmlist ?? [])
        .map((id) => cms.get(id))
        .filter(Boolean)
        .slice(0, MAX_ACTIVITIES_PER_SECTION)
        .map((cm) => ({
          id: cm.id,
          name: truncate(cm.name),
          // `module` est le nom technique (resource, assign…) ; `modname` est traduit.
          type: truncate(cm.module ?? cm.modname, 50),
          url: moodleUrlOrNull(cm.url),
        })),
    }));
}

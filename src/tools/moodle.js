import { z } from 'zod';
import { runTool, THIRD_PARTY_NOTICE } from './result.js';

const MAX_DAYS = 90;
const DEFAULT_DAYS = 14;

const text = z.string().nullable();
const READ_ONLY = { readOnlyHint: true, openWorldHint: true };

const courseShape = z.object({
  id: z.number().int(),
  name: text,
  shortName: text,
  category: text,
  url: text,
  startDate: text,
  endDate: text,
  progress: z.number().nullable(),
});

const deadlineShape = z.object({
  courseId: z.number().int().nullable(),
  courseName: text,
  name: text,
  type: text,
  due: text,
  url: text,
  overdue: z.boolean(),
});

const activityShape = z.object({ id: z.number().int(), name: text, type: text, url: text });
const sectionShape = z.object({
  id: z.number().int(),
  name: text,
  activities: z.array(activityShape),
});
const bookShape = z.object({ docid: z.string(), linkText: text });

export const inputSchemas = {
  upcomingDeadlines: z.object({
    days: z
      .number()
      .int()
      .min(1)
      .max(MAX_DAYS)
      .default(DEFAULT_DAYS)
      .describe('Fenêtre en jours (1 à 90)'),
  }),
  getCourse: z.object({
    courseId: z.number().int().positive().describe('Identifiant du cours Moodle'),
  }),
  download: z.object({
    url: z
      .string()
      .max(2048)
      .describe(
        'URL https://moodle.cesi.fr : /pluginfile.php/…, /mod/resource/view.php?id=… ou /mod/folder/…',
      ),
  }),
};

function countActivities(sections) {
  return sections.reduce((total, section) => total + section.activities.length, 0);
}

export function registerMoodleTools(server, { moodle }) {
  server.registerTool(
    'moodle_list_courses',
    {
      title: 'Cours Moodle',
      description: `Liste les cours Moodle où l'étudiant est inscrit (id, nom, catégorie, lien, dates, progression). ${THIRD_PARTY_NOTICE}`,
      outputSchema: { courses: z.array(courseShape) },
      annotations: READ_ONLY,
    },
    () =>
      runTool(
        'moodle_list_courses',
        async () => ({ courses: await moodle.listCourses() }),
        ({ courses }) => `${courses.length} cours.`,
      ),
  );

  server.registerTool(
    'moodle_upcoming_deadlines',
    {
      title: 'Échéances Moodle',
      description: `Devoirs, quiz et autres activités à rendre dans les N prochains jours (et celles en retard depuis 7 jours au plus), triés par échéance (heure de Paris). ${THIRD_PARTY_NOTICE}`,
      inputSchema: inputSchemas.upcomingDeadlines,
      outputSchema: { deadlines: z.array(deadlineShape) },
      annotations: READ_ONLY,
    },
    ({ days }) =>
      runTool(
        'moodle_upcoming_deadlines',
        async () => ({ deadlines: await moodle.upcomingDeadlines(days) }),
        ({ deadlines }) => `${deadlines.length} échéance(s) sur ${days} jour(s).`,
      ),
  );

  server.registerTool(
    'moodle_get_course',
    {
      title: 'Contenu d’un cours Moodle',
      description: `Sections et activités visibles d'un cours Moodle (nom, type, lien), et livres Scholarvox référencés (docid à passer à scholarvox_get_toc). ${THIRD_PARTY_NOTICE}`,
      inputSchema: inputSchemas.getCourse,
      outputSchema: {
        id: z.number().int(),
        name: text,
        sections: z.array(sectionShape),
        scholarvoxBooks: z.array(bookShape),
      },
      annotations: READ_ONLY,
    },
    ({ courseId }) =>
      runTool(
        'moodle_get_course',
        () => moodle.getCourse(courseId),
        ({ sections, scholarvoxBooks }) =>
          `${sections.length} section(s), ${countActivities(sections)} activité(s), ${scholarvoxBooks.length} livre(s) Scholarvox.`,
      ),
  );

  server.registerTool(
    'moodle_download_resource',
    {
      title: 'Télécharger une ressource Moodle',
      description: `Télécharge un fichier de cours (moodle.cesi.fr uniquement) dans le dossier de téléchargement local, sans écraser de fichier existant ; refuse les pages HTML. Renvoie le chemin, la taille et le type. ${THIRD_PARTY_NOTICE}`,
      inputSchema: inputSchemas.download,
      outputSchema: { path: z.string(), size: z.number().int(), contentType: text },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ url }) =>
      runTool(
        'moodle_download_resource',
        () => moodle.download(url),
        ({ path, size }) => `Fichier enregistré : ${path} (${size} octets).`,
      ),
  );
}

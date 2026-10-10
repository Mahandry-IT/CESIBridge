import { z } from 'zod';
import { runTool, THIRD_PARTY_NOTICE } from './result.js';
import { parseScholarvoxDocid, scholarvoxUrl } from '../scholarvox/docid.js';
import { getTableOfContents, ScholarvoxError } from '../scholarvox/toc.js';

// Objet à champs exclusifs plutôt qu'union : un inputSchema MCP doit être de type objet.
export const tocInputSchema = z
  .object({
    docid: z
      .string()
      .regex(/^\d{1,12}$/, 'docid : chiffres attendus')
      .optional()
      .describe('Identifiant du livre (chiffres)'),
    url: z
      .string()
      .max(2048)
      .optional()
      .describe('Lien https://univ.scholarvox.com/reader/docid/{docid}/…'),
  })
  .refine((input) => (input.docid === undefined) !== (input.url === undefined), {
    message: 'fournir docid ou url (un seul des deux)',
  });

export function docidFromInput({ docid, url }) {
  if (docid) return docid;
  if (!scholarvoxUrl(url)) {
    throw new ScholarvoxError('URL refusée : https://univ.scholarvox.com uniquement');
  }
  const parsed = parseScholarvoxDocid(url);
  if (!parsed) throw new ScholarvoxError('docid introuvable dans l’URL');
  return parsed;
}

export function registerScholarvoxTools(server, { fetch = globalThis.fetch } = {}) {
  server.registerTool(
    'scholarvox_get_toc',
    {
      title: 'Sommaire d’un livre Scholarvox',
      description: `Sommaire (titre, chapitres et sous-chapitres avec niveau et page) d'un livre Scholarvox référencé par un cours, sans connexion. Jamais le texte des chapitres. ${THIRD_PARTY_NOTICE}`,
      inputSchema: tocInputSchema,
      outputSchema: {
        docid: z.string(),
        title: z.string().nullable(),
        entries: z.array(
          z.object({
            name: z.string().nullable(),
            page: z.number().int().nullable(),
            level: z.number().int(),
          }),
        ),
        truncated: z.boolean(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (input) =>
      runTool(
        'scholarvox_get_toc',
        () => getTableOfContents(docidFromInput(input), { fetch }),
        ({ title, entries }) => `${title ?? 'Titre inconnu'} : ${entries.length} entrée(s).`,
      ),
  );
}

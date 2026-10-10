import { z } from 'zod';
import { SCHOLARVOX_HOST } from './docid.js';
import { truncate } from '../text.js';
import { describeNetworkError } from '../net.js';

const REQUEST_TIMEOUT_MS = 15_000;
export const MAX_TOC_ENTRIES = 1000;
const TITLE_SUFFIX = / - ScholarVox Université\s*$/;
const MAX_TITLE_HTML_BYTES = 512 * 1024;

export class ScholarvoxError extends Error {
  name = 'ScholarvoxError';
}

const intLike = z.union([z.number(), z.string().trim().regex(/^\d+$/)]).transform(Number);

const entrySchema = z.looseObject({
  name: z.string().trim().min(1),
  page: intLike.optional().catch(undefined),
  level: intLike.pipe(z.number().int().min(0).max(20)),
});

/** Tableau plat `[{ item, name, page, level }]` → entrées valides, `level` entier ; borné. */
export function mapTocEntries(body) {
  if (!Array.isArray(body)) throw new ScholarvoxError('sommaire Scholarvox inattendu');
  const entries = [];
  for (const raw of body) {
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success) continue;
    entries.push({
      name: truncate(parsed.data.name),
      page: parsed.data.page ?? null,
      level: parsed.data.level,
    });
    if (entries.length >= MAX_TOC_ENTRIES) break;
  }
  return { entries, truncated: entries.length >= MAX_TOC_ENTRIES && body.length > entries.length };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** `<title>{titre} - ScholarVox Université</title>` → titre ; null si la page n'est pas celle d'un livre. */
export function parseBookTitle(html) {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!raw || !TITLE_SUFFIX.test(raw)) return null;
  const title = raw
    .replace(TITLE_SUFFIX, '')
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, name) => ENTITIES[name])
    .replace(/\s+/g, ' ');
  return truncate(title) || null;
}

async function fetchWithTimeout(fetchFn, url, accept) {
  return fetchFn(url, {
    headers: { accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

// Titre best-effort : toute erreur → null. Redirection hors Scholarvox (page de login…) → null.
async function fetchBookTitle(docid, fetchFn) {
  try {
    const url = `https://${SCHOLARVOX_HOST}/reader/docid/${docid}/page/1`;
    const response = await fetchWithTimeout(fetchFn, url, 'text/html');
    if (!response.ok || new URL(response.url || url).hostname !== SCHOLARVOX_HOST) return null;
    const html = (await response.text()).slice(0, MAX_TITLE_HTML_BYTES);
    return parseBookTitle(html);
  } catch {
    return null;
  }
}

async function fetchToc(docid, fetchFn) {
  let response;
  try {
    response = await fetchWithTimeout(
      fetchFn,
      `https://${SCHOLARVOX_HOST}/catalog/toc/${docid}`,
      'application/json',
    );
  } catch (error) {
    throw new ScholarvoxError(describeNetworkError(error, 'Scholarvox'));
  }
  if (!response.ok) throw new ScholarvoxError(`Scholarvox : statut HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new ScholarvoxError('Scholarvox : réponse non JSON');
  }
}

/**
 * Sommaire d'un livre (JSON public, sans connexion). Jamais le texte des chapitres (licence).
 * @returns {Promise<{ docid: string, title: string|null, entries: Array<{ name, page, level }>, truncated: boolean }>}
 */
export async function getTableOfContents(docid, { fetch: fetchFn = globalThis.fetch } = {}) {
  if (!/^\d{1,12}$/.test(docid)) throw new ScholarvoxError('docid invalide');
  const [body, title] = await Promise.all([
    fetchToc(docid, fetchFn),
    fetchBookTitle(docid, fetchFn),
  ]);
  return { docid, title, ...mapTocEntries(body) };
}

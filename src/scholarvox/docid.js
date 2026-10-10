import { truncate } from '../text.js';

export const SCHOLARVOX_HOST = 'univ.scholarvox.com';
const DOCID_PATH = /^\/reader\/docid\/(\d{1,12})(?:\/|$)/;
const MAX_BOOKS = 100;

/** URL https sur l'hôte Scholarvox, sans identifiants ni port explicite ; `URL` ou null. */
export function scholarvoxUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const ok =
    url.protocol === 'https:' &&
    url.hostname === SCHOLARVOX_HOST &&
    url.port === '' &&
    url.username === '' &&
    url.password === '';
  return ok ? url : null;
}

/** `https://univ.scholarvox.com/reader/docid/{docid}/page/{n}` → docid (chiffres) ; sinon null. */
export function parseScholarvoxDocid(value) {
  const url = scholarvoxUrl(value);
  return url?.pathname.match(DOCID_PATH)?.[1] ?? null;
}

/** Liens `{ href, text }` d'une page de cours → livres Scholarvox dédoublonnés par docid. */
export function extractScholarvoxBooks(links) {
  const books = new Map();
  for (const { href, text } of links) {
    const docid = parseScholarvoxDocid(href);
    if (docid && !books.has(docid)) books.set(docid, { docid, linkText: truncate(text) || null });
    if (books.size >= MAX_BOOKS) break;
  }
  return [...books.values()];
}

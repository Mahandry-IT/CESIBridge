import { mkdir, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isMoodleUrl } from './constants.js';
import { describeNetworkError } from '../net.js';

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;
const MAX_NAME_LENGTH = 150;
const MAX_NAME_SUFFIX = 100;
const FALLBACK_NAME = 'fichier';
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

export class DownloadError extends Error {
  name = 'DownloadError';
}

function isAllowedPath(pathname) {
  return (
    pathname.startsWith('/pluginfile.php/') ||
    pathname === '/mod/resource/view.php' ||
    pathname.startsWith('/mod/folder/')
  );
}

/** URL de ressource Moodle autorisée → `URL` ; sinon `DownloadError`. Ajoute `redirect=1` aux ressources. */
export function validateDownloadUrl(value) {
  if (!isMoodleUrl(value))
    throw new DownloadError('URL refusée : https://moodle.cesi.fr uniquement');
  const url = new URL(value);
  if (!isAllowedPath(url.pathname)) {
    throw new DownloadError(
      'URL refusée : /pluginfile.php/…, /mod/resource/view.php ou /mod/folder/… attendu',
    );
  }
  // Sans `redirect=1`, Moodle peut afficher la ressource dans une page HTML au lieu du fichier.
  if (url.pathname === '/mod/resource/view.php') url.searchParams.set('redirect', '1');
  return url;
}

/** Nom de fichier sûr : sans chemin, séparateurs, caractères de contrôle ni nom réservé ; borné. */
export function sanitizeFilename(raw) {
  let name = String(raw ?? '')
    .split(/[/\\]/)
    .pop()
    .normalize('NFC')
    // Caractères de contrôle Unicode (Cc), dont le NUL.
    .replace(/\p{Cc}/gu, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (!name) return FALLBACK_NAME;
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  if (name.length > MAX_NAME_LENGTH) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
    name = name.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
  }
  return name;
}

function decodeSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Nom depuis `Content-Disposition` (`filename*` prioritaire), sinon dernier segment du chemin. */
export function filenameFrom(contentDisposition, url) {
  const header = contentDisposition ?? '';
  const extended = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  if (extended) return sanitizeFilename(decodeSafe(extended[1].trim()));
  const plain = header.match(/filename\s*=\s*(?:"([^"]*)"|([^;]+))/);
  if (plain) return sanitizeFilename(plain[1] ?? plain[2].trim());
  return sanitizeFilename(decodeSafe(new URL(url).pathname.split('/').pop()));
}

// Ouvre un fichier qui n'existe pas encore (`wx`) : `nom.ext`, puis `nom-1.ext`, `nom-2.ext`…
async function createUniqueFile(dir, filename) {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  for (let index = 0; index <= MAX_NAME_SUFFIX; index += 1) {
    const path = join(dir, index === 0 ? filename : `${base}-${index}${ext}`);
    try {
      return { path, handle: await open(path, 'wx', 0o600) };
    } catch (error) {
      if (error.code !== 'EEXIST') throw new DownloadError('écriture du fichier impossible');
    }
  }
  throw new DownloadError('trop de fichiers du même nom');
}

// Suit les redirections à la main pour vérifier que chaque étape reste sur Moodle.
async function fetchFollowingMoodle(fetchFn, start, cookieHeader, signal) {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response;
    try {
      response = await fetchFn(url.href, {
        redirect: 'manual',
        headers: { cookie: cookieHeader, accept: '*/*' },
        signal,
      });
    } catch (error) {
      throw new DownloadError(describeNetworkError(error, 'Moodle'));
    }
    if (response.status < 300 || response.status >= 400) return { response, finalUrl: url };
    await response.body?.cancel().catch(() => {});
    const location = response.headers.get('location');
    const next = location ? new URL(location, url) : null;
    if (!next || !isMoodleUrl(next.href)) {
      throw new DownloadError('redirection hors de moodle.cesi.fr refusée');
    }
    if (next.pathname.startsWith('/login')) throw new DownloadError('session Moodle expirée');
    url = next;
  }
  throw new DownloadError('trop de redirections');
}

async function writeBody(response, path, handle, maxBytes) {
  let size = 0;
  try {
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > maxBytes)
        throw new DownloadError(`fichier trop volumineux (max ${maxBytes} octets)`);
      await handle.write(chunk);
    }
    await handle.close();
    return size;
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(path).catch(() => {});
    if (error instanceof DownloadError) throw error;
    throw new DownloadError('téléchargement interrompu');
  }
}

// Requête validée jusqu'aux en-têtes : hôte, redirections, statut, refus du HTML, Content-Length.
async function requestResource({ url, cookieHeader, maxBytes, fetchFn }) {
  const start = validateDownloadUrl(url);
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const { response, finalUrl } = await fetchFollowingMoodle(fetchFn, start, cookieHeader, signal);
  const discard = () => response.body?.cancel().catch(() => {});
  if (!response.ok) {
    await discard();
    throw new DownloadError(`téléchargement : statut HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type');
  if (/^\s*text\/html/i.test(contentType ?? '')) {
    await discard();
    throw new DownloadError('pas un fichier : Moodle a renvoyé une page HTML');
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard();
    throw new DownloadError(`fichier trop volumineux (max ${maxBytes} octets)`);
  }
  return { response, finalUrl, contentType, discard };
}

function mimeType(contentType) {
  return contentType?.split(';')[0].trim() || null;
}

/**
 * Télécharge une ressource Moodle dans `dir` (cookies du contexte transmis en en-tête).
 * Refuse les pages HTML, applique la taille maximale (Content-Length puis compteur en flux),
 * n'écrase jamais un fichier existant.
 * @returns {Promise<{ path: string, size: number, contentType: string|null }>}
 */
export async function downloadResource({
  url,
  cookieHeader,
  dir,
  maxBytes,
  fetch: fetchFn = globalThis.fetch,
}) {
  const { response, finalUrl, contentType } = await requestResource({
    url,
    cookieHeader,
    maxBytes,
    fetchFn,
  });
  const target = resolve(dir);
  await mkdir(target, { recursive: true, mode: 0o700 });
  const filename = filenameFrom(response.headers.get('content-disposition'), finalUrl);
  const { path, handle } = await createUniqueFile(target, filename);
  const size = await writeBody(response, path, handle, maxBytes);
  return { path, size, contentType: mimeType(contentType) };
}

/**
 * Télécharge une ressource Moodle en mémoire, avec les mêmes contrôles que `downloadResource`.
 * `accept(mime)` doit renvoyer vrai pour le type MIME reçu (sans paramètres), sinon `DownloadError`.
 * @returns {Promise<{ bytes: Buffer, contentType: string }>}
 */
export async function fetchResourceBytes({
  url,
  cookieHeader,
  maxBytes,
  fetch: fetchFn = globalThis.fetch,
  accept,
}) {
  const { response, contentType, discard } = await requestResource({
    url,
    cookieHeader,
    maxBytes,
    fetchFn,
  });
  const mime = mimeType(contentType);
  if (!mime || !accept(mime)) {
    await discard();
    throw new DownloadError(`type de fichier refusé : ${mime ?? 'inconnu'}`);
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > maxBytes)
        throw new DownloadError(`fichier trop volumineux (max ${maxBytes} octets)`);
      chunks.push(chunk);
    }
  } catch (error) {
    await discard();
    if (error instanceof DownloadError) throw error;
    throw new DownloadError('téléchargement interrompu');
  }
  return { bytes: Buffer.concat(chunks), contentType: mime };
}

import { z } from 'zod';
import { isMoodleSessionError, MoodleError } from './errors.js';
import { describeNetworkError } from '../net.js';

const REQUEST_TIMEOUT_MS = 30_000;
const METHOD_PATTERN = /^[a-z0-9_]+$/;

const responseSchema = z
  .array(
    z.looseObject({
      error: z.boolean(),
      data: z.unknown().optional(),
      exception: z.looseObject({ errorcode: z.string().optional() }).optional(),
    }),
  )
  .min(1);

// Certaines erreurs (session) sont renvoyées hors tableau : `{ error, errorcode }`.
const topLevelErrorSchema = z.looseObject({ errorcode: z.string() });

/** Interprète la réponse de `service.php` : données de l'appel ou `MoodleError`. */
export function parseServiceResponse(body) {
  const topLevel = topLevelErrorSchema.safeParse(body);
  if (topLevel.success) {
    throw new MoodleError(`erreur Moodle (${topLevel.data.errorcode})`, topLevel.data.errorcode);
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new MoodleError('réponse Moodle inattendue');
  const [first] = parsed.data;
  if (first.error) {
    const code = first.exception?.errorcode ?? 'inconnue';
    throw new MoodleError(`erreur Moodle (${code})`, code);
  }
  return first.data;
}

/**
 * Client de l'API AJAX interne (`/lib/ajax/service.php`), via `context.request` : les cookies du
 * contexte suivent, sans exécuter de code dans la page ni dépendre de sa navigation.
 * `open()` (ré)ouvre Moodle et renvoie `{ sesskey, wwwroot }` ; erreur de session → un seul nouvel essai.
 */
export function createMoodleClient({ request, open }) {
  let current = null;

  async function post({ sesskey, wwwroot }, methodname, args) {
    const url = new URL('/lib/ajax/service.php', wwwroot);
    url.search = new URLSearchParams({ sesskey, info: methodname }).toString();
    let response;
    try {
      response = await request.post(url.href, {
        data: [{ index: 0, methodname, args }],
        headers: { accept: 'application/json' },
        timeout: REQUEST_TIMEOUT_MS,
        maxRedirects: 0,
      });
    } catch (error) {
      // Message Playwright jamais relayé : il contient l'URL, donc la sesskey.
      throw new MoodleError(describeNetworkError(error, 'Moodle'));
    }
    if (response.status() !== 200)
      throw new MoodleError(`Moodle : statut HTTP ${response.status()}`);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new MoodleError('Moodle : réponse non JSON');
    }
    return parseServiceResponse(body);
  }

  // Moodle ouvert une seule fois par client ; renvoie `{ sesskey, wwwroot }` (usage interne).
  async function ensureOpen() {
    current ??= await open();
    return current;
  }

  async function call(methodname, args) {
    if (!METHOD_PATTERN.test(methodname)) throw new MoodleError('méthode Moodle invalide');
    await ensureOpen();
    try {
      return await post(current, methodname, args);
    } catch (error) {
      if (!isMoodleSessionError(error)) throw error;
      current = await open();
      return post(current, methodname, args);
    }
  }

  return { call, ensureOpen };
}

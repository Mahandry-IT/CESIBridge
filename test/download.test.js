import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DownloadError,
  downloadResource,
  filenameFrom,
  sanitizeFilename,
  validateDownloadUrl,
} from '../src/moodle/download.js';

const FILE_URL = 'https://moodle.cesi.fr/pluginfile.php/1/mod_resource/content/1/cours.pdf';

function response({ status = 200, headers = {}, chunks = [] } = {}) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), body };
}

describe('validateDownloadUrl', () => {
  it.each([
    'http://moodle.cesi.fr/pluginfile.php/1/a.pdf',
    'https://moodle.cesi.fr.evil.com/pluginfile.php/1/a.pdf',
    'https://evil.com/pluginfile.php/1/a.pdf',
    'https://user:pw@moodle.cesi.fr/pluginfile.php/1/a.pdf',
    'https://moodle.cesi.fr:8443/pluginfile.php/1/a.pdf',
    'https://moodle.cesi.fr/course/view.php?id=1',
    'https://moodle.cesi.fr/login/logout.php',
    'pas une url',
  ])('refuse %s', (url) => {
    expect(() => validateDownloadUrl(url)).toThrow(DownloadError);
  });

  it('accepte les chemins autorisés et force redirect=1 sur les ressources', () => {
    expect(validateDownloadUrl(FILE_URL).href).toBe(FILE_URL);
    expect(
      validateDownloadUrl('https://moodle.cesi.fr/mod/folder/download_folder.php?id=3'),
    ).toBeTruthy();
    expect(
      validateDownloadUrl('https://moodle.cesi.fr/mod/resource/view.php?id=7').searchParams.get(
        'redirect',
      ),
    ).toBe('1');
  });
});

describe('sanitizeFilename / filenameFrom', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\Windows\\win.ini', 'win.ini'],
    ['..', 'fichier'],
    ['', 'fichier'],
    ['a\u0000b\u001fc.pdf', 'abc.pdf'],
    ['a<b>:c|d?.pdf', 'a_b__c_d_.pdf'],
    ['CON.txt', '_CON.txt'],
    [' .cache. ', 'cache'],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('borne la longueur en gardant l’extension', () => {
    const name = sanitizeFilename(`${'a'.repeat(400)}.pdf`);

    expect(name).toHaveLength(150);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it.each([
    [`attachment; filename*=UTF-8''Cours%20r%C3%A9seau.pdf`, 'Cours réseau.pdf'],
    ['inline; filename="../tp1.docx"', 'tp1.docx'],
    [null, 'cours.pdf'],
  ])('Content-Disposition %j -> %j', (header, expected) => {
    expect(filenameFrom(header, FILE_URL)).toBe(expected);
  });
});

describe('downloadResource', () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cesibridge-dl-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const run = (fetch, options = {}) =>
    downloadResource({
      url: FILE_URL,
      cookieHeader: 'MoodleSession=x',
      dir,
      maxBytes: 1000,
      fetch,
      ...options,
    });

  it('enregistre le fichier, transmet les cookies, sans suivre de redirection automatique', async () => {
    const fetch = vi.fn(async () =>
      response({ headers: { 'content-type': 'application/pdf; qs=1' }, chunks: ['abc', 'def'] }),
    );

    const result = await run(fetch);

    expect(result).toEqual({
      path: join(dir, 'cours.pdf'),
      size: 6,
      contentType: 'application/pdf',
    });
    expect(await readFile(result.path, 'utf8')).toBe('abcdef');
    const [, init] = fetch.mock.calls[0];
    expect(init).toMatchObject({ redirect: 'manual', headers: { cookie: 'MoodleSession=x' } });
  });

  it('suit une redirection interne à Moodle', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({ status: 303, headers: { location: '/pluginfile.php/2/x/tp.zip' } }),
      )
      .mockResolvedValueOnce(
        response({ headers: { 'content-type': 'application/zip' }, chunks: ['z'] }),
      );

    const result = await run(fetch, { url: 'https://moodle.cesi.fr/mod/resource/view.php?id=7' });

    expect(result.path).toBe(join(dir, 'tp.zip'));
    expect(fetch.mock.calls[1][0]).toBe('https://moodle.cesi.fr/pluginfile.php/2/x/tp.zip');
  });

  it.each([
    ['hors domaine', 'https://evil.com/a.pdf', /hors de moodle/],
    ['en http', 'http://moodle.cesi.fr/pluginfile.php/1/a.pdf', /hors de moodle/],
    ['vers le login', '/login/index.php', /session Moodle expirée/],
  ])('refuse une redirection %s', async (_label, location, message) => {
    const fetch = vi.fn(async () => response({ status: 302, headers: { location } }));

    await expect(run(fetch)).rejects.toThrow(message);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuse une page HTML', async () => {
    const fetch = vi.fn(async () =>
      response({ headers: { 'content-type': 'text/html; charset=utf-8' }, chunks: ['<html>'] }),
    );

    await expect(run(fetch)).rejects.toThrow(/pas un fichier/);
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuse un Content-Length trop grand', async () => {
    const fetch = vi.fn(async () =>
      response({ headers: { 'content-type': 'application/pdf', 'content-length': '5000' } }),
    );

    await expect(run(fetch)).rejects.toThrow(/trop volumineux/);
  });

  it('coupe un flux qui dépasse la taille maximale et supprime le fichier partiel', async () => {
    const fetch = vi.fn(async () =>
      response({
        headers: { 'content-type': 'application/pdf' },
        chunks: ['x'.repeat(600), 'y'.repeat(600)],
      }),
    );

    await expect(run(fetch)).rejects.toThrow(/trop volumineux/);
    expect(await readdir(dir)).toEqual([]);
  });

  it('n’écrase pas un fichier existant (suffixe -1, -2)', async () => {
    await writeFile(join(dir, 'cours.pdf'), 'ancien');
    await writeFile(join(dir, 'cours-1.pdf'), 'ancien');
    const fetch = vi.fn(async () =>
      response({ headers: { 'content-type': 'application/pdf' }, chunks: ['neuf'] }),
    );

    const result = await run(fetch);

    expect(result.path).toBe(join(dir, 'cours-2.pdf'));
    expect(await readFile(join(dir, 'cours.pdf'), 'utf8')).toBe('ancien');
  });

  it('URL refusée avant tout appel réseau', async () => {
    const fetch = vi.fn();

    await expect(
      run(fetch, { url: 'https://evil.com/pluginfile.php/1/a.pdf' }),
    ).rejects.toBeInstanceOf(DownloadError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

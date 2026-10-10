import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { extractScholarvoxBooks, parseScholarvoxDocid } from '../src/scholarvox/docid.js';
import {
  getTableOfContents,
  mapTocEntries,
  MAX_TOC_ENTRIES,
  parseBookTitle,
  ScholarvoxError,
} from '../src/scholarvox/toc.js';

const tocFixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'scholarvox-toc.json'), 'utf8'),
);

describe('parseScholarvoxDocid', () => {
  it.each([
    ['https://univ.scholarvox.com/reader/docid/88812345/page/17', '88812345'],
    ['https://univ.scholarvox.com/reader/docid/88812345', '88812345'],
    ['https://UNIV.scholarvox.com/reader/docid/1/page/1?x=1', '1'],
    ['http://univ.scholarvox.com/reader/docid/88812345/page/1', null],
    ['https://univ.scholarvox.com.evil.com/reader/docid/88812345/page/1', null],
    ['https://user@univ.scholarvox.com/reader/docid/88812345/page/1', null],
    ['https://univ.scholarvox.com/reader/docid/abc/page/1', null],
    ['https://univ.scholarvox.com/catalog/toc/88812345', null],
    ['pas une url', null],
  ])('%s -> %s', (url, expected) => {
    expect(parseScholarvoxDocid(url)).toBe(expected);
  });
});

describe('extractScholarvoxBooks', () => {
  it('dédoublonne par docid et ignore les autres liens', () => {
    const books = extractScholarvoxBooks([
      { href: 'https://univ.scholarvox.com/reader/docid/111/page/1', text: '  Livre A ' },
      { href: 'https://univ.scholarvox.com/reader/docid/111/page/40', text: 'Livre A, chap. 3' },
      { href: 'https://example.com/reader/docid/222/page/1', text: 'Piège' },
      { href: 'https://univ.scholarvox.com/reader/docid/333/page/2', text: '' },
    ]);

    expect(books).toEqual([
      { docid: '111', linkText: 'Livre A' },
      { docid: '333', linkText: null },
    ]);
  });
});

describe('mapTocEntries', () => {
  it('convertit level en entier et ignore les entrées invalides', () => {
    const { entries, truncated } = mapTocEntries(tocFixture);

    expect(entries).toEqual([
      { name: 'Couverture', page: 1, level: 0 },
      { name: 'Chapitre 1 - Introduction', page: 9, level: 0 },
      { name: '1.1 Notions de base', page: 11, level: 1 },
      { name: '1.1.1 Détail', page: 12, level: 2 },
      { name: 'Sans page', page: null, level: 0 },
    ]);
    expect(truncated).toBe(false);
  });

  it(`borne à ${MAX_TOC_ENTRIES} entrées`, () => {
    const body = Array.from({ length: MAX_TOC_ENTRIES + 5 }, (_, i) => ({
      name: `E${i}`,
      page: i,
      level: '0',
    }));

    const { entries, truncated } = mapTocEntries(body);

    expect(entries).toHaveLength(MAX_TOC_ENTRIES);
    expect(truncated).toBe(true);
  });

  it('réponse non tableau : ScholarvoxError', () => {
    expect(() => mapTocEntries({ error: 'x' })).toThrow(ScholarvoxError);
  });
});

describe('parseBookTitle', () => {
  it.each([
    ['<title>Réseaux &amp; protocoles - ScholarVox Université</title>', 'Réseaux & protocoles'],
    ['<title>Connexion</title>', null],
    ['<html></html>', null],
  ])('%s -> %s', (html, expected) => {
    expect(parseBookTitle(html)).toBe(expected);
  });
});

function jsonResponse(body, { status = 200, url } = {}) {
  return { ok: status >= 200 && status < 300, status, url, json: async () => body };
}

function htmlResponse(html, { url } = {}) {
  return { ok: true, status: 200, url, text: async () => html };
}

describe('getTableOfContents', () => {
  const READER = 'https://univ.scholarvox.com/reader/docid/123/page/1';

  it('sommaire + titre, via les URL publiques attendues', async () => {
    const fetch = vi.fn(async (url) =>
      url.includes('/catalog/toc/')
        ? jsonResponse(tocFixture)
        : htmlResponse('<title>Livre - ScholarVox Université</title>', { url: READER }),
    );

    const toc = await getTableOfContents('123', { fetch });

    expect(toc.docid).toBe('123');
    expect(toc.title).toBe('Livre');
    expect(toc.entries).toHaveLength(5);
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual([
      'https://univ.scholarvox.com/catalog/toc/123',
      READER,
    ]);
  });

  it('titre indisponible ou redirigé hors Scholarvox : null', async () => {
    const fetch = vi.fn(async (url) =>
      url.includes('/catalog/toc/')
        ? jsonResponse(tocFixture)
        : htmlResponse('<title>X - ScholarVox Université</title>', {
            url: 'https://login.example.com/',
          }),
    );

    await expect(getTableOfContents('123', { fetch })).resolves.toMatchObject({ title: null });
  });

  it('statut HTTP en erreur : ScholarvoxError', async () => {
    const fetch = vi.fn(async () => jsonResponse(null, { status: 404 }));

    await expect(getTableOfContents('123', { fetch })).rejects.toThrow(/statut HTTP 404/);
  });

  it('refuse un docid non numérique sans appel réseau', async () => {
    const fetch = vi.fn();

    await expect(getTableOfContents('../x', { fetch })).rejects.toBeInstanceOf(ScholarvoxError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

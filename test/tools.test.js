import { describe, expect, it, vi } from 'vitest';
import { LoginRequiredError } from '../src/browser/sessionManager.js';
import { MoodleError } from '../src/moodle/errors.js';
import { inputSchemas } from '../src/tools/moodle.js';
import { describeToolError, runTool } from '../src/tools/result.js';
import { docidFromInput, tocInputSchema } from '../src/tools/scholarvox.js';

describe('paramètres des outils Moodle', () => {
  it('days : 14 par défaut, borné à 1..90', () => {
    expect(inputSchemas.upcomingDeadlines.parse({})).toEqual({ days: 14 });
    for (const days of [0, 91, 2.5, '7']) {
      expect(inputSchemas.upcomingDeadlines.safeParse({ days }).success).toBe(false);
    }
  });

  it('courseId : entier strictement positif', () => {
    expect(inputSchemas.getCourse.safeParse({ courseId: 6346 }).success).toBe(true);
    for (const courseId of [0, -1, 1.5, '6346', undefined]) {
      expect(inputSchemas.getCourse.safeParse({ courseId }).success).toBe(false);
    }
  });

  it('url : chaîne bornée', () => {
    expect(inputSchemas.download.safeParse({ url: 'x'.repeat(3000) }).success).toBe(false);
  });
});

describe('scholarvox_get_toc : paramètres', () => {
  it.each([
    [{ docid: '123' }, true],
    [{ url: 'https://univ.scholarvox.com/reader/docid/123/page/1' }, true],
    [{}, false],
    [{ docid: '123', url: 'https://univ.scholarvox.com/reader/docid/123/page/1' }, false],
    [{ docid: '12a' }, false],
  ])('%j -> %s', (input, valid) => {
    expect(tocInputSchema.safeParse(input).success).toBe(valid);
  });

  it('extrait le docid de l’URL et refuse les autres domaines', () => {
    expect(docidFromInput({ url: 'https://univ.scholarvox.com/reader/docid/42/page/3' })).toBe(
      '42',
    );
    expect(() => docidFromInput({ url: 'https://evil.com/reader/docid/42/page/3' })).toThrow(
      /univ.scholarvox.com uniquement/,
    );
    expect(() => docidFromInput({ url: 'https://univ.scholarvox.com/catalog' })).toThrow(
      /docid introuvable/,
    );
  });
});

describe('erreurs des outils', () => {
  it('session absente sans identifiants : procédure cesi_login', () => {
    const message = describeToolError(new LoginRequiredError('x'), 'outil');

    expect(message).toContain('docker compose --profile login');
  });

  it('erreur métier : message conservé ; erreur inconnue : message masqué', () => {
    expect(describeToolError(new MoodleError('erreur Moodle (invalidrecord)'), 'outil')).toBe(
      'erreur Moodle (invalidrecord)',
    );
    const leaky = new Error('https://moodle.cesi.fr/?sesskey=SECRET');
    expect(describeToolError(leaky, 'outil')).not.toContain('SECRET');
  });

  it('runTool : structuredContent en cas de succès, isError sinon', async () => {
    const ok = await runTool(
      'outil',
      async () => ({ n: 1 }),
      ({ n }) => `${n}`,
    );
    const ko = await runTool('outil', vi.fn().mockRejectedValue(new Error('x')), () => '');

    expect(ok).toEqual({ content: [{ type: 'text', text: '1' }], structuredContent: { n: 1 } });
    expect(ko.isError).toBe(true);
  });
});

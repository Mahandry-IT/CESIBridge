import { describe, expect, it } from 'vitest';
import { extractCodePersonne } from '../src/schedule/codePersonne.js';

describe('extractCodePersonne', () => {
  it("lit le code dans l'URL de l'API des séances", () => {
    const url =
      'https://ent.cesi.fr/api/seance/all?start=2026-10-12&end=2026-10-18&codePersonne=123&_=1';

    expect(extractCodePersonne(url)).toBe('123');
  });

  it.each([
    ['autre route', 'https://ent.cesi.fr/api/seance/prochaines?codePersonne=123'],
    ['paramètre absent', 'https://ent.cesi.fr/api/seance/all?start=2026-10-12'],
    ['code non numérique', 'https://ent.cesi.fr/api/seance/all?codePersonne=abc'],
    ['URL invalide', 'pas une url'],
  ])('renvoie null : %s', (_label, url) => {
    expect(extractCodePersonne(url)).toBeNull();
  });
});

// Longueur maximale d'un texte tiers renvoyé par un outil MCP.
export const MAX_TEXT_LENGTH = 500;

/** Tronque une chaîne (contenu tiers) ; autre type → null. */
export function truncate(value, max = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

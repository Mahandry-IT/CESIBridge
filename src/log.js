// stdout est réservé au protocole MCP : tout log passe par stderr.
export function log(...args) {
  console.error('[cesibridge]', ...args);
}

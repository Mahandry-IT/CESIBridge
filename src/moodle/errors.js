/** Erreur renvoyée par Moodle ou réponse inattendue. Le message ne contient ni URL ni sesskey. */
export class MoodleError extends Error {
  name = 'MoodleError';

  constructor(message, errorcode = null) {
    super(message);
    this.errorcode = errorcode;
  }
}

// Codes qui signifient « session Moodle à rouvrir ».
const SESSION_ERROR_CODES = new Set([
  'invalidsesskey',
  'requireloginerror',
  'servicerequireslogin',
]);

export function isMoodleSessionError(error) {
  return error instanceof MoodleError && SESSION_ERROR_CODES.has(error.errorcode);
}

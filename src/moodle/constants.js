// Hôte Moodle CESI : vérifié explicitement, indépendamment de CESI_LOGGED_IN_HOSTS.
export const MOODLE_HOST = 'moodle.cesi.fr';

/** URL https sur l'hôte Moodle, sans identifiants ni port explicite. */
export function isMoodleUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.hostname === MOODLE_HOST &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''
  );
}

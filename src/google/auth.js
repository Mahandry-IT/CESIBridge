import { readFile } from 'node:fs/promises';
import { JWT } from 'google-auth-library';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

// Lit la clé du compte de service. Les erreurs ne citent jamais le contenu du fichier.
export async function readServiceAccountKey(keyFile) {
  let text;
  try {
    text = await readFile(keyFile, 'utf8');
  } catch {
    throw new Error(`Clé du compte de service illisible : ${keyFile}`);
  }
  let key;
  try {
    key = JSON.parse(text);
  } catch {
    throw new Error(`Clé du compte de service invalide (JSON attendu) : ${keyFile}`);
  }
  if (typeof key?.client_email !== 'string' || typeof key?.private_key !== 'string') {
    throw new Error(`Clé du compte de service invalide (client_email/private_key) : ${keyFile}`);
  }
  return key;
}

/** Fournisseur de jeton d'accès (JWT du compte de service), clé lue à la première utilisation. */
export function createTokenProvider(keyFile) {
  let jwt;
  return async () => {
    if (!jwt) {
      const key = await readServiceAccountKey(keyFile);
      jwt = new JWT({ email: key.client_email, key: key.private_key, scopes: [SCOPE] });
    }
    try {
      const { token } = await jwt.getAccessToken();
      if (!token) throw new Error('jeton vide');
      return token;
    } catch {
      // Le message d'origine peut contenir des éléments de la réponse OAuth : on ne le reprend pas.
      throw new Error("Obtention du jeton Google impossible (vérifier la clé et l'API Calendar)");
    }
  };
}

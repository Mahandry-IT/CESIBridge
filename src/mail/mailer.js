import nodemailer from 'nodemailer';

const SMTPS_PORT = 465;
// Bornes explicites : un serveur SMTP muet ne doit pas bloquer la synchronisation.
const CONNECTION_TIMEOUT_MS = 15_000;
const GREETING_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 30_000;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,31}$/;

export class MailError extends Error {
  name = 'MailError';
}

// Le message d'origine peut contenir la réponse brute du serveur (donc, parfois, des identifiants) :
// on ne garde que le code court de nodemailer (EAUTH, ETIMEDOUT…).
function wrap(error) {
  const code = ERROR_CODE.test(error?.code ?? '') ? ` (${error.code})` : '';
  return new MailError(`envoi du mail impossible${code}`);
}

/**
 * Expéditeur SMTP : `send({ subject, text, html })` vers `to`, avec l'adresse `user` comme expéditeur.
 * TLS implicite sur 465, sinon STARTTLS exigé : jamais d'identifiants en clair.
 */
export function createMailer(
  { host, port, user, password, to },
  { createTransport = nodemailer.createTransport } = {},
) {
  const transport = createTransport({
    host,
    port,
    secure: port === SMTPS_PORT,
    requireTLS: port !== SMTPS_PORT,
    auth: { user, pass: password },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
  return {
    async send({ subject, text, html }) {
      try {
        // `priority: 'high'` pose X-Priority, X-MSMail-Priority et Importance.
        await transport.sendMail({ from: user, to, subject, text, html, priority: 'high' });
      } catch (error) {
        throw wrap(error);
      }
    },
  };
}

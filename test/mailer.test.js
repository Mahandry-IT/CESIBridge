import { describe, expect, it, vi } from 'vitest';
import { createMailer, MailError } from '../src/mail/mailer.js';

const settings = (override = {}) => ({
  host: 'smtp.example.fr',
  port: 465,
  user: 'moi@example.fr',
  password: 'app-pass-word',
  to: 'dest@example.fr',
  ...override,
});
const fakeTransport = (sendMail = vi.fn(async () => ({}))) => {
  const createTransport = vi.fn(() => ({ sendMail }));
  return { createTransport, sendMail };
};
const mail = { subject: 'S', text: 'T', html: '<p>T</p>' };

describe('createMailer', () => {
  it('utilise le TLS implicite sur le port 465, avec timeouts explicites', () => {
    const { createTransport } = fakeTransport();
    createMailer(settings(), { createTransport });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.fr',
        port: 465,
        secure: true,
        requireTLS: false,
        auth: { user: 'moi@example.fr', pass: 'app-pass-word' },
        connectionTimeout: expect.any(Number),
        greetingTimeout: expect.any(Number),
        socketTimeout: expect.any(Number),
      }),
    );
  });

  it('exige STARTTLS sur un autre port', () => {
    const { createTransport } = fakeTransport();
    createMailer(settings({ port: 587 }), { createTransport });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false, requireTLS: true }),
    );
  });

  it('envoie en priorité haute, de user vers le destinataire', async () => {
    const { createTransport, sendMail } = fakeTransport();
    await createMailer(settings(), { createTransport }).send(mail);
    expect(sendMail).toHaveBeenCalledWith({
      from: 'moi@example.fr',
      to: 'dest@example.fr',
      ...mail,
      priority: 'high',
    });
  });

  it('enveloppe l’erreur sans mot de passe ni réponse du serveur', async () => {
    const raw = Object.assign(new Error('535 bad login app-pass-word'), {
      code: 'EAUTH',
      response: '535 app-pass-word',
    });
    const { createTransport } = fakeTransport(async () => {
      throw raw;
    });
    const error = await createMailer(settings(), { createTransport })
      .send(mail)
      .catch((e) => e);
    expect(error).toBeInstanceOf(MailError);
    expect(error.message).toBe('envoi du mail impossible (EAUTH)');
    expect(error.message).not.toContain('app-pass-word');
    expect(error.cause).toBeUndefined();
  });

  it('ignore un code d’erreur qui ne ressemble pas à un code', async () => {
    const { createTransport } = fakeTransport(async () => {
      throw Object.assign(new Error('x'), { code: 'mot de passe: app-pass-word' });
    });
    await expect(createMailer(settings(), { createTransport }).send(mail)).rejects.toThrow(
      /^envoi du mail impossible$/,
    );
  });
});

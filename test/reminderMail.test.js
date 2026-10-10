import { describe, expect, it } from 'vitest';
import { buildReminderMail } from '../src/mail/reminderMail.js';

const exam = (override = {}) => ({
  id: 'ex-1',
  element: 'Algorithmique - Recherche opérationnelle (CCTL)',
  bloc: '[A3 FISE info] Algorithmique',
  format: 'Test',
  plateforme: 'Global Exam',
  session: 'Initiale',
  date: '2026-11-05',
  debut: '08:45',
  fin: '09:40',
  aVerifier: [],
  coursUrl: null,
  ...override,
});
const due = (restant, override) => ({ exam: exam(override), restant, seuils: [7] });
const IMAGE = 'https://moodle.cesi.fr/cal.png';

describe('buildReminderMail objet', () => {
  it('commence par le préfixe fixe et l’échéance la plus proche', () => {
    expect(buildReminderMail([due(7)]).subject).toBe(
      '[CESI Examen] J-7 : Algorithmique - Recherche opérationnelle (CCTL)',
    );
  });

  it.each([
    [0, "Aujourd'hui"],
    [1, 'Demain'],
    [3, 'J-3'],
  ])('J-%i : %s', (restant, label) => {
    expect(buildReminderMail([due(restant)]).subject).toBe(
      `[CESI Examen] ${label} : Algorithmique - Recherche opérationnelle (CCTL)`,
    );
  });

  it('indique les autres examens, au pluriel', () => {
    const one = buildReminderMail([due(3), due(5, { id: 'b' })]).subject;
    const two = buildReminderMail([due(3), due(5), due(6)]).subject;
    expect(one.endsWith(' (+1 autre)')).toBe(true);
    expect(two.endsWith(' (+2 autres)')).toBe(true);
  });

  it('garde l’objet sur une seule ligne', () => {
    expect(buildReminderMail([due(7, { element: 'A\r\nBcc: x@y.z' })]).subject).not.toMatch(
      /[\r\n]/,
    );
  });
});

describe('buildReminderMail corps', () => {
  it('décrit l’examen en texte, date longue française comprise', () => {
    const { text } = buildReminderMail([due(7, { coursUrl: 'https://moodle.cesi.fr/c?id=1' })], {
      imageUrl: IMAGE,
    });
    expect(text).toContain('Échéance : dans 7 jours');
    expect(text).toContain('Date : jeudi 5 novembre 2026');
    expect(text).toContain('Horaires : 08:45 – 09:40');
    expect(text).toContain('Bloc : [A3 FISE info] Algorithmique');
    expect(text).toContain('Format : Test');
    expect(text).toContain('Plateforme : Global Exam');
    expect(text).toContain('Cours : https://moodle.cesi.fr/c?id=1');
    expect(text).toContain(`Calendrier d'origine : ${IMAGE}`);
  });

  it('dit demain / aujourd’hui', () => {
    expect(buildReminderMail([due(1)]).text).toContain('Échéance : demain');
    expect(buildReminderMail([due(0)]).text).toContain("Échéance : aujourd'hui");
  });

  it('indique la journée entière sans horaires ou si l’horaire est douteux', () => {
    expect(buildReminderMail([due(7, { debut: null, fin: null })]).text).toContain(
      'Horaires : journée entière',
    );
    expect(buildReminderMail([due(7, { aVerifier: ['horaire'] })]).text).toContain(
      'Horaires : journée entière',
    );
  });

  it('préfixe les rattrapages, sans tenir compte de la casse', () => {
    const { text, html } = buildReminderMail([due(7, { session: 'RATTRAPAGE' })]);
    expect(text).toContain('[Rattrapage] Algorithmique');
    expect(html).toContain('<h3>[Rattrapage] Algorithmique');
  });

  it('signale une lecture à vérifier, sinon rien', () => {
    expect(buildReminderMail([due(7, { aVerifier: ['date'] })]).text).toContain('⚠ à vérifier');
    expect(buildReminderMail([due(7)]).text).not.toContain('⚠');
  });

  it('omet les lignes vides et le pied sans calendrier', () => {
    const { text } = buildReminderMail([due(7, { bloc: null, format: null, plateforme: null })]);
    expect(text).not.toMatch(/Bloc|Format|Plateforme|Cours|Calendrier/);
  });

  it('liste tous les examens', () => {
    const { text } = buildReminderMail([due(3), due(5, { element: 'Réseaux' })]);
    expect(text).toContain('Algorithmique');
    expect(text).toContain('Réseaux');
  });
});

describe('buildReminderMail HTML', () => {
  const hostile = '<script>alert("x")</script> & "q"';

  it('échappe tous les libellés', () => {
    const { html } = buildReminderMail([
      due(7, { element: hostile, bloc: hostile, format: hostile, plateforme: hostile }),
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;q&quot;');
  });

  it('crée des liens https, échappés', () => {
    const { html } = buildReminderMail(
      [due(7, { coursUrl: 'https://moodle.cesi.fr/c?a=1&b="2"' })],
      {
        imageUrl: IMAGE,
      },
    );
    expect(html).toContain('<a href="https://moodle.cesi.fr/c?a=1&amp;b=%222%22">');
    expect(html).toContain(`<a href="${IMAGE}">Calendrier d'origine</a>`);
  });

  it.each(['javascript:alert(1)', 'http://moodle.cesi.fr/c', 'data:text/html,x', 'pas une url'])(
    'ignore le lien non https %s',
    (url) => {
      const mail = buildReminderMail([due(7, { coursUrl: url })], { imageUrl: url });
      expect(mail.html).not.toContain('<a ');
      expect(mail.text).not.toMatch(/Cours|Calendrier/);
    },
  );
});

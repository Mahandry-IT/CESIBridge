// Préfixe fixe : sert de critère au filtre Gmail qui marque ces mails comme importants.
export const SUBJECT_PREFIX = '[CESI Examen]';

// Fuseau UTC sur une date civile : aucun décalage possible du jour affiché.
const longDate = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

// Les libellés viennent d'un OCR de document tiers : sur une seule ligne dans l'objet.
const oneLine = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

/** URL https normalisée, ou `null` : jamais de lien `javascript:`, `data:` ou http. */
function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const deadline = (restant) => {
  if (restant === 0) return "aujourd'hui";
  if (restant === 1) return 'demain';
  return `dans ${restant} jours`;
};

const shortDeadline = (restant) => {
  if (restant === 0) return "Aujourd'hui";
  if (restant === 1) return 'Demain';
  return `J-${restant}`;
};

function subjectOf(reminders) {
  const [{ exam, restant }] = reminders;
  const others = reminders.length - 1;
  const more = others > 0 ? ` (+${others} ${others > 1 ? 'autres' : 'autre'})` : '';
  return `${SUBJECT_PREFIX} ${shortDeadline(restant)} : ${oneLine(exam.element)}${more}`;
}

const isRetake = (exam) => exam.session?.toLowerCase() === 'rattrapage';

const timeOf = (exam) =>
  exam.debut && exam.fin && !exam.aVerifier.includes('horaire')
    ? `${exam.debut} – ${exam.fin}`
    : 'journée entière';

// Lignes `[libellé, valeur]` d'un examen ; le titre et l'avertissement sont rendus à part.
function detailsOf({ exam, restant }) {
  return [
    ['Échéance', deadline(restant)],
    ['Date', longDate.format(new Date(`${exam.date}T00:00:00Z`))],
    ['Horaires', timeOf(exam)],
    ['Bloc', exam.bloc],
    ['Format', exam.format],
    ['Plateforme', exam.plateforme],
  ].filter(([, value]) => value);
}

const titleOf = ({ exam }) => `${isRetake(exam) ? '[Rattrapage] ' : ''}${oneLine(exam.element)}`;
const WARNING = '⚠ à vérifier (date/horaire lus automatiquement)';

function textBlock(reminder) {
  const { exam } = reminder;
  const lines = [titleOf(reminder), ...detailsOf(reminder).map(([k, v]) => `  ${k} : ${v}`)];
  if (exam.aVerifier.length > 0) lines.push(`  ${WARNING}`);
  const course = httpsUrl(exam.coursUrl);
  if (course) lines.push(`  Cours : ${course}`);
  return lines.join('\n');
}

function htmlBlock(reminder) {
  const { exam } = reminder;
  const items = detailsOf(reminder).map(
    ([key, value]) => `<li>${escapeHtml(key)} : ${escapeHtml(value)}</li>`,
  );
  if (exam.aVerifier.length > 0) items.push(`<li>${WARNING}</li>`);
  const course = httpsUrl(exam.coursUrl);
  if (course)
    items.push(`<li>Cours : <a href="${escapeHtml(course)}">${escapeHtml(course)}</a></li>`);
  return `<h3>${escapeHtml(titleOf(reminder))}</h3>\n<ul>\n${items.join('\n')}\n</ul>`;
}

/**
 * Mail récapitulatif (un par exécution) : `{ subject, text, html }`.
 * `reminders` vient de `dueReminders` (non vide, trié) ; `imageUrl` : lien du calendrier d'origine.
 */
export function buildReminderMail(reminders, { imageUrl } = {}) {
  const image = httpsUrl(imageUrl);
  const text = [
    ...reminders.map(textBlock),
    ...(image ? [`Calendrier d'origine : ${image}`] : []),
  ].join('\n\n');
  const footer = image ? [`<p><a href="${escapeHtml(image)}">Calendrier d'origine</a></p>`] : [];
  const html = `<!doctype html>\n<html lang="fr"><body>\n${[...reminders.map(htmlBlock), ...footer].join('\n')}\n</body></html>`;
  return { subject: subjectOf(reminders), text, html };
}

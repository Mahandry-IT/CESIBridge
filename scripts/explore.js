// Étape 1 : parcourt la chaîne de login SSO dans une fenêtre visible et journalise les redirections.
// Usage : npm run explore [-- <url ENT>]   (sinon CESI_ENT_URL)
// ⚠️ data/login.har contient des cookies et des jetons : ne jamais le committer ni le partager.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { z } from 'zod';

const OUT_DIR = 'data';
const HAR_PATH = `${OUT_DIR}/login.har`;
const LOG_PATH = `${OUT_DIR}/redirects.log`;

/** Retire les valeurs des paramètres (SAMLRequest, code, state…) : seuls les noms sont gardés. */
function redact(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const params = [...url.searchParams.keys()];
    return `${url.origin}${url.pathname}${params.length ? `?${params.join('&')}` : ''}`;
  } catch {
    return '<url invalide>';
  }
}

const entUrl = z.url().safeParse(process.argv[2] ?? process.env.CESI_ENT_URL);
if (!entUrl.success) {
  console.error('URL ENT manquante ou invalide : passer une URL ou définir CESI_ENT_URL.');
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
const lines = [];
const hosts = [];
const record = (line, url) => {
  lines.push(`${new Date().toISOString()} ${line}`);
  console.error(line);
  const host = new URL(url).hostname;
  if (host && !hosts.includes(host)) hosts.push(host);
};

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ recordHar: { path: HAR_PATH, content: 'omit' } });

context.on('response', (response) => {
  const request = response.request();
  if (!request.isNavigationRequest()) return;
  const location = response.headers().location;
  const target = location ? ` -> ${redact(new URL(location, response.url()).href)}` : '';
  record(
    `${response.status()} ${request.method()} ${redact(response.url())}${target}`,
    response.url(),
  );
});
context.on('page', (page) =>
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) record(`NAV ${redact(frame.url())}`, frame.url());
  }),
);

const done = new Promise((resolve) => {
  context.on('page', (page) =>
    page.on('close', () => context.pages().length === 0 && resolve('fenêtre fermée')),
  );
  process.once('SIGINT', () => resolve('SIGINT'));
});

const page = await context.newPage();
console.error(`Connecte-toi dans la fenêtre, puis ferme-la. Départ : ${entUrl.data}`);
await page
  .goto(entUrl.data)
  .catch((error) => console.error('navigation initiale :', error.message));

console.error(`Fin de l'exploration (${await done}).`);
await context.close(); // écrit le HAR
await browser.close();
await writeFile(LOG_PATH, `${lines.join('\n')}\n`, { mode: 0o600 });

console.error(`\nHAR : ${HAR_PATH}\nJournal : ${LOG_PATH}\nDomaines traversés, dans l'ordre :`);
hosts.forEach((host, index) => console.error(`  ${index + 1}. ${host}`));
console.error(
  '\nReporter dans CESI_LOGGED_IN_HOSTS les hôtes atteints une fois connecté (ENT, Moodle…).',
);

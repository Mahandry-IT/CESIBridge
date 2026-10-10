import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createBrowserProvider, launchBrowser } from './browser/session.js';
import { createSessionManager } from './browser/sessionManager.js';
import { createMoodleService } from './moodle/service.js';
import { registerCheckSession } from './tools/checkSession.js';
import { registerLogin } from './tools/login.js';
import { registerMoodleTools } from './tools/moodle.js';
import { registerScholarvoxTools } from './tools/scholarvox.js';
import { log } from './log.js';

const { version } = createRequire(import.meta.url)('../package.json');

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    log(error.message);
    process.exit(1);
  }

  const browsers = createBrowserProvider(() => launchBrowser({ headless: true }));
  const server = new McpServer({ name: 'cesibridge', version });
  const getBrowser = () => browsers.get();
  // Sans CESI_EMAIL/CESI_PASSWORD, pas de reconnexion automatique : les outils renvoient la procédure cesi_login.
  const sessions = createSessionManager({ getBrowser, config, credentials: config.credentials });
  registerCheckSession(server, { config, getBrowser });
  registerLogin(server);
  registerMoodleTools(server, { moodle: createMoodleService({ sessions, config }) });
  registerScholarvoxTools(server);

  let closing = false;
  const shutdown = async (reason) => {
    if (closing) return;
    closing = true;
    log(`arrêt (${reason})`);
    await browsers.close().catch((error) => log('fermeture du navigateur :', error.message));
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.stdin.on('end', () => shutdown('stdin fermé'));

  await server.connect(new StdioServerTransport());
  log(`serveur MCP v${version} prêt (stdio)`);
}

main().catch((error) => {
  log('erreur fatale :', error?.message ?? error);
  process.exit(1);
});

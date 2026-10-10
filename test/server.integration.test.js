import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const SERVER = join(import.meta.dirname, '..', 'src', 'server.js');
const env = {
  ...process.env,
  CESI_ENT_URL: 'https://ent.example.invalid/',
  CESI_LOGGED_IN_HOSTS: 'ent.example.invalid',
  CESI_STATE_PATH: join(tmpdir(), 'cesibridge-absent', 'state.json'),
  // Pas de reconnexion automatique dans les tests (chaîne vide = variable absente).
  CESI_EMAIL: '',
  CESI_PASSWORD: '',
};

describe('serveur MCP (stdio)', () => {
  let client;
  afterEach(async () => {
    await client?.close();
  });

  it('expose les outils et répond sans navigateur si la session est absente', async () => {
    client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [SERVER], env }),
    );

    const { tools } = await client.listTools();
    const check = await client.callTool({ name: 'cesi_check_session', arguments: {} });
    const login = await client.callTool({ name: 'cesi_login', arguments: {} });

    expect(tools.map((t) => t.name).sort()).toEqual([
      'cesi_check_session',
      'cesi_login',
      'moodle_download_resource',
      'moodle_get_course',
      'moodle_list_courses',
      'moodle_upcoming_deadlines',
      'scholarvox_get_toc',
    ]);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const name of [
      'moodle_list_courses',
      'moodle_upcoming_deadlines',
      'moodle_get_course',
      'scholarvox_get_toc',
    ]) {
      expect(byName[name].annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
      expect(byName[name].outputSchema).toBeDefined();
      expect(byName[name].description).toContain('site tiers');
    }
    expect(byName.moodle_download_resource.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
    expect(byName.scholarvox_get_toc.inputSchema.type).toBe('object');
    expect(check.structuredContent.status).toBe('absent');
    expect(login.content[0].text).toContain('localhost:6080');
  });

  it('outils Moodle sans session ni identifiants : procédure de login, sans navigateur', async () => {
    client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [SERVER], env }),
    );

    const result = await client.callTool({ name: 'moodle_list_courses', arguments: {} });
    const invalid = await client.callTool({
      name: 'moodle_get_course',
      arguments: { courseId: -1 },
    });
    const refused = await client.callTool({
      name: 'moodle_download_resource',
      arguments: { url: 'https://evil.example.com/pluginfile.php/1/a.pdf' },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('localhost:6080');
    expect(invalid.isError).toBe(true);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain('moodle.cesi.fr uniquement');
  });

  it('stdout ne contient que du JSON-RPC', async () => {
    const child = spawn(process.execPath, [SERVER], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    let stdout = '';
    const listed = new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.includes('"id":2')) resolve();
      });
      child.on('exit', () => reject(new Error(`serveur arrêté, stdout=${stdout}`)));
    });
    const send = (message) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    });
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list' });
    await listed;
    child.kill();

    const lines = stdout.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) expect(JSON.parse(line).jsonrpc).toBe('2.0');
  });

  it('échoue vite avec une configuration invalide', async () => {
    const child = spawn(process.execPath, [SERVER], {
      env: { PATH: process.env.PATH },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));

    const code = await new Promise((resolve) => child.on('exit', resolve));

    expect(code).toBe(1);
    expect(stderr).toContain('CESI_ENT_URL');
  });
});

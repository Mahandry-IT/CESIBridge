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
};

describe('serveur MCP (stdio)', () => {
  let client;
  afterEach(async () => {
    await client?.close();
  });

  it('expose les deux outils et répond sans navigateur si la session est absente', async () => {
    client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [SERVER], env }),
    );

    const { tools } = await client.listTools();
    const check = await client.callTool({ name: 'cesi_check_session', arguments: {} });
    const login = await client.callTool({ name: 'cesi_login', arguments: {} });

    expect(tools.map((t) => t.name).sort()).toEqual(['cesi_check_session', 'cesi_login']);
    expect(check.structuredContent.status).toBe('absent');
    expect(login.content[0].text).toContain('localhost:6080');
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

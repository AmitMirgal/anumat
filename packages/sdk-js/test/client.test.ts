import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { expect, test } from 'vitest';
import { createAnumatClient } from '@anumat/js';

const API_KEY = 'test-key-0123456789abcdef';

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Could not bind a local port');
  const { port } = address;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForHealth(baseUrl: string, child: ChildProcess) {
  const deadline = Date.now() + 30_000;
  let last = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`API did not listen (${last})`);
}

test('a typed client lists payers through /trpc', async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn('pnpm', ['--filter', '@anumat/api', 'exec', 'tsx', '--env-file-if-exists=../../.env', 'src/main.ts'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://anumat:anumat@127.0.0.1:5432/anumat_test',
      ANUMAT_API_KEYS: `tester:${API_KEY}`,
      ANUMAT_LLM_MODE: 'replay',
      LOG_LEVEL: 'silent',
    },
    stdio: 'ignore',
  });
  try {
    await waitForHealth(baseUrl, child);
    const client = createAnumatClient({ baseUrl, apiKey: API_KEY });
    const page = await client.payers.list.query({ limit: 20 });
    expect(Array.isArray(page.items)).toBe(true);
    expect(page.next_cursor === null || typeof page.next_cursor === 'string').toBe(true);
  } finally {
    child.kill('SIGTERM');
  }
});

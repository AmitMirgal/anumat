import { chdir } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { closeContext, createContext, loadConfig, log } from '@anumat/engine';
import { createApp } from './http/app';

chdir(join(dirname(fileURLToPath(import.meta.url)), '../../..'));

const config = loadConfig();
const ctx = await createContext(config);
const server = serve({ fetch: createApp({ ctx }).fetch, hostname: config.host, port: config.port }, (info) => {
  log.info({ url: `http://${info.address}:${info.port}` }, 'anumat listening');
});

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  server.close();
  await closeContext(ctx);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

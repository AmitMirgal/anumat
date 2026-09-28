import { serve } from '@hono/node-server';
import { loadConfig } from './config';
import { closeContext, createContext } from './context';
import { createApp } from './http/app';
import { log } from './log';

const config = loadConfig();
const ctx = await createContext(config);
const server = serve({ fetch: createApp(ctx).fetch, hostname: config.host, port: config.port }, (info) => {
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

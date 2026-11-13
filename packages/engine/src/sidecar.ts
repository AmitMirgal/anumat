import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { toAppError } from '@anumat/core';
import * as z from 'zod';
import { closeContext } from './context';
import { pdfToMarkdown } from './convert/pdf-to-markdown';
import { createEngine, type CreateEngineOptions, type EngineStorage } from './engine';
import { callEngineMethod, toJson } from './sidecar-rpc';
import { runBundledMigrations } from './sidecar-migrate';

const usage = 'Usage: anumat-engine migrate --db <url> | anumat-engine convert --pdf <file>';
const bodyLimit = 32 * 1024 * 1024;

if (!process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
  const candidate = join(dirname(process.execPath), 'anydoc.node');
  if (existsSync(candidate)) process.env.NAPI_RS_NATIVE_LIBRARY_PATH = candidate;
}

const localStorage = z.object({
  kind: z.literal('local'),
  dataDir: z.string().min(1).optional(),
});

const s3Storage = z.object({
  kind: z.literal('s3'),
  region: z.string().min(1),
  bucket: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  endpoint: z.url().optional(),
});

const gcsStorage = z.object({
  kind: z.literal('gcs'),
  bucket: z.string().min(1),
  projectId: z.string().min(1).optional(),
  keyFilename: z.string().min(1).optional(),
});

const supabaseStorage = z.object({
  kind: z.literal('supabase'),
  url: z.url(),
  apiKey: z.string().min(1),
  bucket: z.string().min(1),
});

const serveConfig = z.object({
  databaseUrl: z.string().min(1).optional(),
  storage: z.discriminatedUnion('kind', [localStorage, s3Storage, gcsStorage, supabaseStorage]).optional(),
  llm: z.object({ strong: z.string(), cheap: z.string() }).optional(),
});

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  if (command === 'migrate') {
    const databaseUrl = parseMigrateArgs(process.argv.slice(2));
    const result = await runBundledMigrations(databaseUrl);
    if (result.applied.length === 0) {
      console.log('No pending migrations to apply.');
      return;
    }
    for (const name of result.applied) console.log(`Applied ${name}`);
    return;
  }
  if (command === 'convert') {
    const pdfPath = parseConvertArgs(process.argv.slice(2));
    const bytes = await readFile(pdfPath);
    const { markdown, converter } = await pdfToMarkdown(bytes, {
      apiKey: process.env.FIRECRAWL_API_KEY,
      apiUrl: process.env.FIRECRAWL_API_URL,
    });
    process.stdout.write(`${JSON.stringify({ converter, markdown })}\n`);
    return;
  }
  if (command === 'serve') {
    if (process.argv.length !== 3) fail(usage);
    await serve();
    return;
  }
  fail(usage);
}

function parseConvertArgs(args: string[]): string {
  if (args[0] !== 'convert') fail(usage);
  let pdfPath: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--pdf') {
      index += 1;
      pdfPath = args[index];
      continue;
    }
    if (arg?.startsWith('--pdf=')) {
      pdfPath = arg.slice('--pdf='.length);
      continue;
    }
    fail(usage);
  }
  if (!pdfPath) fail(usage);
  return pdfPath;
}

function parseMigrateArgs(args: string[]): string {
  if (args[0] !== 'migrate') fail(usage);
  let databaseUrl: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--db') {
      index += 1;
      databaseUrl = args[index];
      continue;
    }
    if (arg?.startsWith('--db=')) {
      databaseUrl = arg.slice('--db='.length);
      continue;
    }
    fail(usage);
  }
  if (!databaseUrl) fail(usage);
  return databaseUrl;
}

async function serve(): Promise<void> {
  const lines = createInterface({ input: process.stdin });
  const line = await new Promise<string>((resolve, reject) => {
    lines.once('line', resolve);
    lines.once('error', reject);
    process.stdin.once('error', reject);
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    fail('serve config must be one JSON object');
  }
  const config = serveConfig.safeParse(parsed);
  if (!config.success) fail(config.error.issues.map((issue) => issue.message).join('\n'));
  const engine = await createEngine(optionsFromConfig(config.data));
  const token = randomBytes(32).toString('hex');
  const server = createServer((req, res) => {
    void handle(req, res, engine, token);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') fail('sidecar did not bind a TCP port');
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await closeContext(engine);
    process.exit(0);
  };
  lines.on('close', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  console.log(
    JSON.stringify({
      port: address.port,
      token,
      config: {
        databaseUrl: engine.config.databaseUrl ?? null,
        storage: engine.config.storage,
        models: engine.config.models,
        firecrawlApiKey: engine.config.firecrawlApiKey ?? null,
        firecrawlApiUrl: engine.config.firecrawlApiUrl ?? null,
      },
    }),
  );
}

function optionsFromConfig(config: z.infer<typeof serveConfig>): CreateEngineOptions {
  const options: CreateEngineOptions = {};
  if (config.databaseUrl !== undefined) options.databaseUrl = config.databaseUrl;
  if (config.storage !== undefined) options.storage = config.storage as EngineStorage;
  if (config.llm !== undefined) options.llm = config.llm;
  return options;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  engine: Awaited<ReturnType<typeof createEngine>>,
  token: string,
): Promise<void> {
  try {
    if (!authorized(req.headers.authorization, token)) {
      send(res, 401, { error: { code: 'unauthorized', message: 'Missing or invalid bearer token' } });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') {
      if (engine.db !== undefined) {
        try {
          await engine.db.$queryRaw`SELECT 1`;
        } catch {
          send(res, 503, { status: 'not_ready' });
          return;
        }
      }
      send(res, 200, { status: 'ok' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/rpc') {
      const body = await readBody(req, bodyLimit);
      let payload: unknown;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        send(res, 400, { error: { code: 'validation_failed', message: 'Request body must be JSON' } });
        return;
      }
      const parsed = z.object({ method: z.string().min(1), input: z.unknown().optional() }).safeParse(payload);
      if (!parsed.success) {
        send(res, 400, { error: { code: 'validation_failed', message: 'Request body must include method' } });
        return;
      }
      const result = toJson(await callEngineMethod(engine, parsed.data.method, parsed.data.input ?? {}));
      send(res, 200, { result });
      return;
    }
    send(res, 404, { error: { code: 'not_found', message: `No route for ${req.method ?? 'UNKNOWN'} ${url.pathname}` } });
  } catch (error) {
    const appError = toAppError(error);
    send(res, appError.status, { error: { code: appError.code, message: appError.message, details: appError.details ?? null } });
  }
}

function authorized(header: string | undefined, token: string): boolean {
  const prefix = 'Bearer ';
  if (!header?.startsWith(prefix)) return false;
  const presented = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

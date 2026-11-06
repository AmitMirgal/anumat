import { AppError } from '@anumat/core';
import { expect, test } from 'vitest';
import { DEFAULT_DATA_DIR } from '../src/config';
import { closeContext } from '../src/context';
import { createEngine, type CreateEngineOptions } from '../src/engine';
import { applyMigrations } from '../src/migrate';
import { migrationsDir, recreateDatabase } from './databases';

const databaseUrl = await recreateDatabase('anumat_engine_api');
await applyMigrations(databaseUrl, migrationsDir);

test('createEngine uses arguments instead of storage, firecrawl, and model env', async () => {
  const previous = snapshotEnv([
    'ANUMAT_STORAGE',
    'ANUMAT_S3_REGION',
    'ANUMAT_S3_BUCKET',
    'ANUMAT_S3_ACCESS_KEY_ID',
    'ANUMAT_S3_SECRET_ACCESS_KEY',
    'FIRECRAWL_API_KEY',
    'FIRECRAWL_API_URL',
    'ANUMAT_STRONG_MODEL',
    'ANUMAT_CHEAP_MODEL',
    'ANUMAT_LLM_MODE',
  ]);
  process.env.ANUMAT_STORAGE = 's3';
  delete process.env.ANUMAT_S3_REGION;
  delete process.env.ANUMAT_S3_BUCKET;
  delete process.env.ANUMAT_S3_ACCESS_KEY_ID;
  delete process.env.ANUMAT_S3_SECRET_ACCESS_KEY;
  process.env.FIRECRAWL_API_KEY = 'from-env';
  process.env.FIRECRAWL_API_URL = 'https://env.example';
  process.env.ANUMAT_STRONG_MODEL = 'openai/gpt-4o';
  process.env.ANUMAT_CHEAP_MODEL = 'openai/gpt-4o-mini';
  process.env.ANUMAT_LLM_MODE = 'replay';
  try {
    const engine = await createEngine({ databaseUrl });
    expect(engine.config.storage).toEqual({ kind: 'local', dataDir: DEFAULT_DATA_DIR });
    expect(engine.config.firecrawlApiKey).toBeUndefined();
    expect(engine.config.firecrawlApiUrl).toBeUndefined();
    expect(engine.config.models).toEqual({ strong: '', cheap: '' });
    expect(engine.agents.us.models.kind).toBe('scripted');
    expect(await engine.db?.payer.count()).toBe(0);
    await closeContext(engine);
  } finally {
    restoreEnv(previous);
  }
});

test('createEngine keeps the storage, llm, and firecrawl arguments', async () => {
  const engine = await createEngine({
    databaseUrl,
    storage: {
      kind: 's3',
      region: 'us-east-1',
      bucket: 'policies',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      endpoint: 'https://s3.example',
    },
    llm: { strong: 'anthropic/claude-sonnet-4-5', cheap: 'anthropic/claude-haiku-4-5' },
    firecrawl: { apiKey: 'fc-key', apiUrl: 'https://firecrawl.example' },
  });
  expect(engine.config.storage).toEqual({
    kind: 's3',
    region: 'us-east-1',
    bucket: 'policies',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    endpoint: 'https://s3.example',
  });
  expect(engine.config.firecrawlApiKey).toBe('fc-key');
  expect(engine.config.firecrawlApiUrl).toBe('https://firecrawl.example');
  expect(engine.agents.us.models).toEqual({
    kind: 'router',
    strong: 'anthropic/claude-sonnet-4-5',
    cheap: 'anthropic/claude-haiku-4-5',
  });
  await closeContext(engine);
});

test('closeContext disconnects a client it opened and leaves a passed db open', async () => {
  const owner = await createEngine({ databaseUrl });
  const db = owner.db;
  if (!db) throw new Error('expected a database client');
  let disconnects = 0;
  const original = db.$disconnect.bind(db);
  db.$disconnect = async () => {
    disconnects += 1;
    return original();
  };
  const shared = await createEngine({ db });
  await closeContext(shared);
  expect(disconnects).toBe(0);
  expect(await db.payer.count()).toBe(0);
  await closeContext(owner);
  expect(disconnects).toBe(1);
});

test('createEngine rejects both databaseUrl and db', async () => {
  const owner = await createEngine({ databaseUrl });
  await expect(createEngine({ databaseUrl, db: owner.db } as unknown as CreateEngineOptions)).rejects.toThrow(/not both/);
  await closeContext(owner);
});

test('a bad database url does not fail storage env validation', async () => {
  const previous = snapshotEnv(['ANUMAT_STORAGE', 'ANUMAT_S3_REGION']);
  process.env.ANUMAT_STORAGE = 's3';
  delete process.env.ANUMAT_S3_REGION;
  try {
    await createEngine({ databaseUrl: 'postgres://anumat:anumat@127.0.0.1:1/none' });
    expect.unreachable();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain('ANUMAT_S3');
    expect(message).not.toContain('Invalid environment');
  } finally {
    restoreEnv(previous);
  }
});

test('createEngine treats omitted options as empty and rejects null', async () => {
  const engine = await createEngine(undefined as never);
  expect(engine.db).toBeUndefined();
  await closeContext(engine);
  await expect(createEngine(null as never)).rejects.toMatchObject({ code: 'validation_failed' });
});

test('createEngine rejects null storage, llm, and firecrawl', async () => {
  await expect(createEngine({ databaseUrl, storage: null } as never)).rejects.toMatchObject({ code: 'validation_failed' });
  await expect(createEngine({ databaseUrl, llm: null } as never)).rejects.toMatchObject({ code: 'validation_failed' });
  await expect(createEngine({ databaseUrl, firecrawl: null } as never)).rejects.toMatchObject({ code: 'validation_failed' });
});

test('createEngine rejects storage that is not a local path or complete cloud config', async () => {
  await expect(createEngine({ databaseUrl, storage: { kind: 'disk' } } as never)).rejects.toMatchObject({ code: 'validation_failed' });
  await expect(createEngine({ databaseUrl, storage: { kind: 'gcs' } } as never)).rejects.toMatchObject({ code: 'validation_failed' });
  await expect(createEngine({ databaseUrl, storage: { kind: 'supabase' } } as never)).rejects.toMatchObject({
    code: 'validation_failed',
  });
  await expect(createEngine({ databaseUrl, storage: {} } as never)).rejects.toMatchObject({ code: 'validation_failed' });
  await expect(createEngine({ databaseUrl, storage: { kind: 'local', dataDir: 5 } } as never)).rejects.toMatchObject({
    code: 'validation_failed',
  });
});

test('createEngine accepts gcs and supabase storage without opening a cloud client', async () => {
  const gcs = await createEngine({ databaseUrl, storage: { kind: 'gcs', bucket: 'policies', projectId: 'proj' } });
  expect(gcs.config.storage).toEqual({ kind: 'gcs', bucket: 'policies', projectId: 'proj', keyFilename: undefined });
  await closeContext(gcs);
  const supabase = await createEngine({
    databaseUrl,
    storage: { kind: 'supabase', url: 'https://example.supabase.co', apiKey: 'service-role-key', bucket: 'policies' },
  });
  expect(supabase.config.storage).toEqual({
    kind: 'supabase',
    url: 'https://example.supabase.co',
    apiKey: 'service-role-key',
    bucket: 'policies',
  });
  await closeContext(supabase);
});

test('createEngine rejects a db that is not a client', async () => {
  await expect(createEngine({ db: null } as never)).rejects.toMatchObject({ code: 'validation_failed' });
  await expect(createEngine({ db: 42 } as never)).rejects.toMatchObject({ code: 'validation_failed' });
});

test('createEngine rejects a non-postgres or oversized databaseUrl', async () => {
  await expect(createEngine({ databaseUrl: 'http://example.test/db' })).rejects.toMatchObject({ code: 'validation_failed' });
  await expect(createEngine({ databaseUrl: `postgres://anumat:anumat@127.0.0.1:5432/${'a'.repeat(4097)}` })).rejects.toMatchObject({
    code: 'validation_failed',
  });
});

test('createEngine rejects unknown options', async () => {
  await expect(createEngine({ databaseUrl, extra: true } as never)).rejects.toMatchObject({ code: 'validation_failed' });
});

test('createEngine config omits host, port, and apiKeys', async () => {
  const engine = await createEngine({ databaseUrl });
  expect('host' in engine.config).toBe(false);
  expect('port' in engine.config).toBe(false);
  expect('apiKeys' in engine.config).toBe(false);
  await closeContext(engine);
});

function snapshotEnv(names: string[]): Map<string, string | undefined> {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(previous: Map<string, string | undefined>): void {
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

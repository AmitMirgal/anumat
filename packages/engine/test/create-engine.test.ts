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
    expect(await engine.db.payer.count()).toBe(0);
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
  let disconnects = 0;
  const original = owner.db.$disconnect.bind(owner.db);
  owner.db.$disconnect = async () => {
    disconnects += 1;
    return original();
  };
  const shared = await createEngine({ db: owner.db });
  await closeContext(shared);
  expect(disconnects).toBe(0);
  expect(await owner.db.payer.count()).toBe(0);
  await closeContext(owner);
  expect(disconnects).toBe(1);
});

test('createEngine rejects zero or two database arguments', async () => {
  await expect(createEngine({} as CreateEngineOptions)).rejects.toThrow(/only one of them/);
  const owner = await createEngine({ databaseUrl });
  await expect(createEngine({ databaseUrl, db: owner.db } as unknown as CreateEngineOptions)).rejects.toThrow(/only one of them/);
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

function snapshotEnv(names: string[]): Map<string, string | undefined> {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(previous: Map<string, string | undefined>): void {
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

import { AppError } from '@anumat/core';
import type { Db } from '@anumat/db';
import type { ModelSource } from './agent/policy-agent';
import { DEFAULT_DATA_DIR, type Config, type S3Storage, type StorageConfig } from './config';
import { type AppContext, createContext } from './context';

export type EngineDb = {
  $disconnect(): Promise<void>;
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

export type EngineStorage =
  | { kind: 'local'; dataDir?: string }
  | {
      kind: 's3';
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      endpoint?: string;
    };

export type EngineLlm = { strong: string; cheap: string };

export type EngineFirecrawl = { apiKey?: string; apiUrl?: string };

export type CreateEngineOptions = (
  | { databaseUrl: string; db?: never }
  | { db: EngineDb; databaseUrl?: never }
) & {
  storage?: EngineStorage;
  llm?: EngineLlm;
  firecrawl?: EngineFirecrawl;
};

const modelId = /^[^/\s]+\/\S+$/;

export async function createEngine(options: CreateEngineOptions): Promise<AppContext> {
  const database = databaseFromOptions(options);
  const storage = storageFromOptions(options.storage);
  const models = modelsFromOptions(options.llm);
  const firecrawl = firecrawlFromOptions(options.firecrawl);
  const config: Config = {
    databaseUrl: database.databaseUrl,
    host: '127.0.0.1',
    port: 4471,
    apiKeys: [],
    storage,
    llmMode: 'live',
    models: models.kind === 'router' ? { strong: models.strong, cheap: models.cheap } : { strong: '', cheap: '' },
    firecrawlApiKey: firecrawl.apiKey,
    firecrawlApiUrl: firecrawl.apiUrl,
    rateLimitPerMinute: 120,
  };
  return createContext(config, { db: database.db as Db | undefined, models });
}

function databaseFromOptions(options: CreateEngineOptions): { databaseUrl: string; db?: EngineDb } {
  const databaseUrl = 'databaseUrl' in options ? options.databaseUrl : undefined;
  const db = 'db' in options ? options.db : undefined;
  if ((databaseUrl === undefined) === (db === undefined)) {
    throw new Error('createEngine requires databaseUrl or db, and only one of them');
  }
  if (databaseUrl !== undefined) {
    if (!URL.canParse(databaseUrl)) throw new Error('databaseUrl must be a URL');
    return { databaseUrl };
  }
  if (db === undefined) throw new Error('createEngine requires databaseUrl or db, and only one of them');
  return { databaseUrl: '', db };
}

function storageFromOptions(storage: EngineStorage | undefined): StorageConfig {
  if (storage === undefined) return { kind: 'local', dataDir: DEFAULT_DATA_DIR };
  switch (storage.kind) {
    case 'local':
      if (storage.dataDir !== undefined && storage.dataDir.length === 0) {
        throw new Error('storage dataDir must be a non-empty path');
      }
      return { kind: 'local', dataDir: storage.dataDir ?? DEFAULT_DATA_DIR };
    case 's3':
      return s3FromOptions(storage);
    default: {
      const unreachable: never = storage;
      return unreachable;
    }
  }
}

function s3FromOptions(storage: Extract<EngineStorage, { kind: 's3' }>): S3Storage {
  const { region, bucket, accessKeyId, secretAccessKey, endpoint } = storage;
  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('storage kind s3 requires region, bucket, accessKeyId, and secretAccessKey');
  }
  if (endpoint !== undefined && !URL.canParse(endpoint)) throw new Error('storage endpoint must be a URL');
  return { kind: 's3', endpoint, region, bucket, accessKeyId, secretAccessKey };
}

function modelsFromOptions(llm: EngineLlm | undefined): ModelSource {
  if (llm === undefined) {
    return {
      kind: 'scripted',
      name: 'unconfigured',
      model() {
        throw new AppError('llm_not_configured', 'Pass llm.strong and llm.cheap to createEngine.');
      },
    };
  }
  if (!modelId.test(llm.strong) || !modelId.test(llm.cheap)) {
    throw new Error('llm.strong and llm.cheap must be provider/model ids');
  }
  return { kind: 'router', strong: llm.strong, cheap: llm.cheap };
}

function firecrawlFromOptions(firecrawl: EngineFirecrawl | undefined): { apiKey: string | undefined; apiUrl: string | undefined } {
  if (firecrawl === undefined) return { apiKey: undefined, apiUrl: undefined };
  if (firecrawl.apiUrl !== undefined && !URL.canParse(firecrawl.apiUrl)) {
    throw new Error('firecrawl apiUrl must be a URL');
  }
  return { apiKey: firecrawl.apiKey, apiUrl: firecrawl.apiUrl };
}

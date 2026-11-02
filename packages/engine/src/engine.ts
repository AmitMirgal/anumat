import { AppError } from '@anumat/core';
import type { Db } from '@anumat/db';
import * as z from 'zod';
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
const maxDatabaseUrlLength = 4096;
const modelIdMessage = 'llm.strong and llm.cheap must be provider/model ids';

const databaseUrlSchema = z.string().superRefine((value, ctx) => {
  if (value.length > maxDatabaseUrlLength) {
    ctx.addIssue({ code: 'custom', message: 'databaseUrl must be at most 4096 characters' });
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'databaseUrl must be a postgres:// or postgresql:// URL' });
    return;
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    ctx.addIssue({ code: 'custom', message: 'databaseUrl must use the postgres:// or postgresql:// scheme' });
  }
});

const engineDbSchema = z.custom<EngineDb>((value) => {
  if (value === null || typeof value !== 'object') return false;
  const record = value as { $queryRaw?: unknown; $disconnect?: unknown };
  return typeof record.$queryRaw === 'function' && typeof record.$disconnect === 'function';
}, 'db must be an object with $queryRaw and $disconnect');

const localStorageSchema = z
  .object({
    kind: z.literal('local'),
    dataDir: z.string().min(1, 'storage dataDir must be a non-empty path').optional(),
  })
  .strict();

const s3StorageSchema = z
  .object({
    kind: z.literal('s3'),
    region: z.string().min(1).optional(),
    bucket: z.string().min(1).optional(),
    accessKeyId: z.string().min(1).optional(),
    secretAccessKey: z.string().min(1).optional(),
    endpoint: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.region || !value.bucket || !value.accessKeyId || !value.secretAccessKey) {
      ctx.addIssue({
        code: 'custom',
        message: 'storage kind s3 requires region, bucket, accessKeyId, and secretAccessKey',
      });
    }
    if (value.endpoint !== undefined && !URL.canParse(value.endpoint)) {
      ctx.addIssue({ code: 'custom', message: 'storage endpoint must be a URL' });
    }
  });

const storageSchema = z.discriminatedUnion('kind', [localStorageSchema, s3StorageSchema]);

const llmSchema = z
  .object({
    strong: z.string().regex(modelId, modelIdMessage),
    cheap: z.string().regex(modelId, modelIdMessage),
  })
  .strict();

const firecrawlSchema = z
  .object({
    apiKey: z.string().optional(),
    apiUrl: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.apiUrl !== undefined && !URL.canParse(value.apiUrl)) {
      ctx.addIssue({ code: 'custom', message: 'firecrawl apiUrl must be a URL' });
    }
  });

const createEngineSchema = z
  .object({
    databaseUrl: databaseUrlSchema.optional(),
    db: engineDbSchema.optional(),
    storage: storageSchema.optional(),
    llm: llmSchema.optional(),
    firecrawl: firecrawlSchema.optional(),
  })
  .strict();

type ParsedEngineOptions = z.infer<typeof createEngineSchema>;

export async function createEngine(options: CreateEngineOptions): Promise<AppContext> {
  const parsed = parseCreateEngineOptions(options);
  const storage = storageFromParsed(parsed.storage);
  const models = modelsFromParsed(parsed.llm);
  const firecrawl = firecrawlFromParsed(parsed.firecrawl);
  const config: Config = {
    databaseUrl: parsed.databaseUrl ?? '',
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
  const context = await createContext(config, { db: parsed.db as Db | undefined, models });
  if (parsed.db === undefined) {
    try {
      await context.db.$queryRaw`SELECT 1`;
    } catch (error) {
      await context.db.$disconnect().catch(() => undefined);
      throw error;
    }
  }
  context.config = visibleConfig(context.config);
  return context;
}

function parseCreateEngineOptions(options: CreateEngineOptions): ParsedEngineOptions {
  const value: unknown = options;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('validation_failed', 'createEngine requires databaseUrl or db, and only one of them');
  }
  const result = createEngineSchema.safeParse(options);
  if (!result.success) {
    throw new AppError('validation_failed', result.error.issues.map((issue) => issue.message).join('\n'));
  }
  if ((result.data.databaseUrl === undefined) === (result.data.db === undefined)) {
    throw new AppError('validation_failed', 'createEngine requires databaseUrl or db, and only one of them');
  }
  return result.data;
}

function visibleConfig(config: Config): Config {
  return {
    databaseUrl: config.databaseUrl,
    storage: config.storage,
    llmMode: config.llmMode,
    models: config.models,
    firecrawlApiKey: config.firecrawlApiKey,
    firecrawlApiUrl: config.firecrawlApiUrl,
    rateLimitPerMinute: config.rateLimitPerMinute,
  } as Config;
}

function storageFromParsed(storage: ParsedEngineOptions['storage']): StorageConfig {
  if (storage === undefined) return { kind: 'local', dataDir: DEFAULT_DATA_DIR };
  switch (storage.kind) {
    case 'local':
      return { kind: 'local', dataDir: storage.dataDir ?? DEFAULT_DATA_DIR };
    case 's3':
      return s3FromParsed(storage);
    default: {
      const unreachable: never = storage;
      return unreachable;
    }
  }
}

function s3FromParsed(storage: Extract<ParsedEngineOptions['storage'], { kind: 's3' }>): S3Storage {
  const { region, bucket, accessKeyId, secretAccessKey, endpoint } = storage;
  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new AppError('validation_failed', 'storage kind s3 requires region, bucket, accessKeyId, and secretAccessKey');
  }
  return { kind: 's3', endpoint, region, bucket, accessKeyId, secretAccessKey };
}

function modelsFromParsed(llm: ParsedEngineOptions['llm']): ModelSource {
  if (llm === undefined) {
    return {
      kind: 'scripted',
      name: 'unconfigured',
      model() {
        throw new AppError('llm_not_configured', 'Pass llm.strong and llm.cheap to createEngine.');
      },
    };
  }
  return { kind: 'router', strong: llm.strong, cheap: llm.cheap };
}

function firecrawlFromParsed(firecrawl: ParsedEngineOptions['firecrawl']): { apiKey: string | undefined; apiUrl: string | undefined } {
  if (firecrawl === undefined) return { apiKey: undefined, apiUrl: undefined };
  return { apiKey: firecrawl.apiKey, apiUrl: firecrawl.apiUrl };
}

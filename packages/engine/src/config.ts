import { z } from 'zod';

const apiKeys = z.string().transform((raw, ctx) => {
  const keys = raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [name, key] = pair.split(':');
      return { name: name ?? '', key: key ?? '' };
    });
  const invalid = keys.find(({ name, key }) => !/^[a-z0-9-]+$/.test(name) || key.length < 16);
  if (keys.length === 0 || invalid) {
    ctx.addIssue({
      code: 'custom',
      message: 'ANUMAT_API_KEYS must be comma-separated name:key pairs, names in [a-z0-9-], keys at least 16 chars',
    });
    return z.NEVER;
  }
  return keys;
});

export const DEFAULT_DATA_DIR = './data/policies';
export const DEFAULT_MODELS = { strong: 'anthropic/claude-sonnet-4-5', cheap: 'anthropic/claude-haiku-4-5' };

// Mastra router ids, provider/model. Defaults stay Anthropic so an existing .env keeps working.
// Google reads GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY. Grok (xAI) reads XAI_API_KEY.
// There is no serum provider in the router. A model id is still provider/model, and serum/<model> is not registered.
export const MODEL_EXAMPLES = {
  google: { strong: 'google/gemini-2.5-pro', cheap: 'google/gemini-2.5-flash' },
  grok: { strong: 'xai/grok-4.3', cheap: 'xai/grok-build-0.1' },
} as const;

const modelRouterId = z
  .string()
  .regex(
    /^[^/\s]+\/\S+$/,
    'Use a Mastra model router id, provider/model. Examples: anthropic/claude-sonnet-4-5, google/gemini-2.5-pro, xai/grok-4.3',
  );

const s3Setting = z.string().min(1);

const EnvSchema = z
  .object({
    DATABASE_URL: z.url(),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4471),
    ANUMAT_API_KEYS: apiKeys,
    ANUMAT_DATA_DIR: z.string().default(DEFAULT_DATA_DIR),
    ANUMAT_STORAGE: z.enum(['local', 's3']).default('local'),
    ANUMAT_S3_ENDPOINT: z.url().optional(),
    ANUMAT_S3_REGION: s3Setting.optional(),
    ANUMAT_S3_BUCKET: s3Setting.optional(),
    ANUMAT_S3_ACCESS_KEY_ID: s3Setting.optional(),
    ANUMAT_S3_SECRET_ACCESS_KEY: s3Setting.optional(),
    ANUMAT_LLM_MODE: z.enum(['live', 'replay']).default('live'),
    ANUMAT_STRONG_MODEL: modelRouterId.default(DEFAULT_MODELS.strong),
    ANUMAT_CHEAP_MODEL: modelRouterId.default(DEFAULT_MODELS.cheap),
    FIRECRAWL_API_KEY: z.string().optional(),
    FIRECRAWL_API_URL: z.url().optional(),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  });

export type LocalStorage = { kind: 'local'; dataDir: string };

export type S3Storage = {
  kind: 's3';
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type StorageConfig = LocalStorage | S3Storage;

export type Config = {
  databaseUrl: string;
  host: string;
  port: number;
  apiKeys: { name: string; key: string }[];
  storage: StorageConfig;
  llmMode: 'live' | 'replay';
  models: { strong: string; cheap: string };
  firecrawlApiKey: string | undefined;
  firecrawlApiUrl: string | undefined;
  rateLimitPerMinute: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== '')));
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    host: e.HOST,
    port: e.PORT,
    apiKeys: e.ANUMAT_API_KEYS,
    storage: storageConfig(e),
    llmMode: e.ANUMAT_LLM_MODE,
    models: { strong: e.ANUMAT_STRONG_MODEL, cheap: e.ANUMAT_CHEAP_MODEL },
    firecrawlApiKey: e.FIRECRAWL_API_KEY,
    firecrawlApiUrl: e.FIRECRAWL_API_URL,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
  };
}

type Env = z.infer<typeof EnvSchema>;

function storageConfig(env: Env): StorageConfig {
  switch (env.ANUMAT_STORAGE) {
    case 'local':
      return { kind: 'local', dataDir: env.ANUMAT_DATA_DIR };
    case 's3':
      return s3Storage(env);
    default: {
      const unreachable: never = env.ANUMAT_STORAGE;
      return unreachable;
    }
  }
}

function s3Storage(env: Env): S3Storage {
  const region = env.ANUMAT_S3_REGION;
  const bucket = env.ANUMAT_S3_BUCKET;
  const accessKeyId = env.ANUMAT_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.ANUMAT_S3_SECRET_ACCESS_KEY;
  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Invalid environment: ANUMAT_STORAGE=s3 requires ANUMAT_S3_REGION, ANUMAT_S3_BUCKET, ANUMAT_S3_ACCESS_KEY_ID, and ANUMAT_S3_SECRET_ACCESS_KEY',
    );
  }
  return { kind: 's3', endpoint: env.ANUMAT_S3_ENDPOINT, region, bucket, accessKeyId, secretAccessKey };
}

import { z } from 'zod';

const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

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

export const DEFAULT_MODELS = { strong: 'anthropic/claude-sonnet-4-5', cheap: 'anthropic/claude-haiku-4-5' };

const EnvSchema = z.object({
  DATABASE_URL: z.url(),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4471),
  ANUMAT_API_KEYS: apiKeys,
  ANUMAT_DATA_DIR: z.string().default('./data/policies'),
  ANUMAT_STORAGE: z.enum(['local', 's3']).default('local'),
  ANUMAT_LLM_MODE: z.enum(['live', 'replay']).default('live'),
  ANUMAT_STRONG_MODEL: z.string().default(DEFAULT_MODELS.strong),
  ANUMAT_CHEAP_MODEL: z.string().default(DEFAULT_MODELS.cheap),
  FIRECRAWL_API_KEY: optionalSecret,
  FIRECRAWL_API_URL: z.url().optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
});

export type Config = {
  databaseUrl: string;
  host: string;
  port: number;
  apiKeys: { name: string; key: string }[];
  dataDir: string;
  storage: 'local' | 's3';
  llmMode: 'live' | 'replay';
  models: { strong: string; cheap: string };
  firecrawlApiKey: string | undefined;
  firecrawlApiUrl: string | undefined;
  rateLimitPerMinute: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    host: e.HOST,
    port: e.PORT,
    apiKeys: e.ANUMAT_API_KEYS,
    dataDir: e.ANUMAT_DATA_DIR,
    storage: e.ANUMAT_STORAGE,
    llmMode: e.ANUMAT_LLM_MODE,
    models: { strong: e.ANUMAT_STRONG_MODEL, cheap: e.ANUMAT_CHEAP_MODEL },
    firecrawlApiKey: e.FIRECRAWL_API_KEY,
    firecrawlApiUrl: e.FIRECRAWL_API_URL,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
  };
}

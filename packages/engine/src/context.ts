import { AppError, resolveEnginePlugins, type EnginePlugins } from '@anumat/core';
import { connect, type Db } from '@anumat/db';
import type { Market } from '@anumat/markets';
import { createPolicyAgent, type ModelSource, type PolicyAgent } from './agent/policy-agent';
import { databaseSources } from './agent/sources';
import type { Config } from './config';
import { type AdapterType, adapters, type SourceAdapter } from './sources/adapters';
import { type BlobStore, createBlobStore } from './storage/blob-store';

const ownedContexts = new WeakSet<AppContext>();

export type AppContext = {
  config: Config;
  db: Db | undefined;
  blobs: BlobStore;
  adapters: Record<AdapterType, SourceAdapter>;
  agents: Record<Market, PolicyAgent>;
  plugins: EnginePlugins;
};

function modelsFromConfig(config: Config): ModelSource {
  if (config.llmMode === 'replay') {
    throw new AppError('validation_failed', 'Pass models when llmMode is replay.');
  }
  return { kind: 'router', ...config.models };
}

export function requireDatabase(ctx: AppContext): Db {
  if (ctx.db === undefined) {
    throw new AppError(
      'database_not_configured',
      'A database is not configured. Pass databaseUrl or db to createEngine to use the catalog, versioning, and approval workflow.',
    );
  }
  return ctx.db;
}

export async function createContext(
  config: Config,
  overrides: {
    db?: Db;
    models?: ModelSource;
    adapters?: Record<AdapterType, SourceAdapter>;
    plugins?: Partial<EnginePlugins>;
  } = {},
): Promise<AppContext> {
  const db = overrides.db ?? (config.databaseUrl ? connect(config.databaseUrl) : undefined);
  const blobs = createBlobStore(config.storage);
  const models = overrides.models ?? modelsFromConfig(config);
  const context: AppContext = {
    config,
    db,
    blobs,
    adapters: overrides.adapters ?? adapters,
    agents: { us: await createPolicyAgent({ market: 'us', models, sources: databaseSources(db, blobs) }) },
    plugins: resolveEnginePlugins(overrides.plugins),
  };
  if (overrides.db === undefined && db !== undefined) ownedContexts.add(context);
  return context;
}

export async function closeContext(ctx: AppContext): Promise<void> {
  if (ownedContexts.has(ctx) && ctx.db) await ctx.db.$disconnect();
}

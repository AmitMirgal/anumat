import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEnginePlugins, type EnginePlugins } from '@anumat/core';
import { connect, type Db } from '@anumat/db';
import type { Market } from '@anumat/markets';
import { createPolicyAgent, type ModelSource, type PolicyAgent } from './agent/policy-agent';
import { fixtureExtractions, replayModels } from './agent/replay-model';
import { databaseSources } from './agent/sources';
import type { Config } from './config';
import { type AdapterType, adapters, type SourceAdapter } from './sources/adapters';
import { type BlobStore, createBlobStore } from './storage/blob-store';

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../evals/fixtures');

export type AppContext = {
  config: Config;
  db: Db;
  blobs: BlobStore;
  adapters: Record<AdapterType, SourceAdapter>;
  agents: Record<Market, PolicyAgent>;
  plugins: EnginePlugins;
};

export function modelSource(config: Config): ModelSource {
  return config.llmMode === 'replay'
    ? replayModels(fixtureExtractions(FIXTURES_DIR, 'expected.json'))
    : { kind: 'router', ...config.models };
}

export async function createContext(
  config: Config,
  overrides: {
    models?: ModelSource;
    adapters?: Record<AdapterType, SourceAdapter>;
    plugins?: Partial<EnginePlugins>;
  } = {},
): Promise<AppContext> {
  const db = connect(config.databaseUrl);
  const blobs = createBlobStore(config.storage);
  const models = overrides.models ?? modelSource(config);
  return {
    config,
    db,
    blobs,
    adapters: overrides.adapters ?? adapters,
    agents: { us: await createPolicyAgent({ market: 'us', models, sources: databaseSources(db, blobs) }) },
    plugins: resolveEnginePlugins(overrides.plugins),
  };
}

export async function closeContext(ctx: AppContext): Promise<void> {
  await ctx.db.$disconnect();
}

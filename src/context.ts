import { createPolicyAgent, type ModelSource, type PolicyAgent } from './agent/policy-agent';
import { fixtureExtractions, replayModels } from './agent/replay-model';
import { databaseSources } from './agent/sources';
import type { Config } from './config';
import { connect, type Db } from './db/client';
import type { Market } from './markets/registry';
import { type AdapterType, adapters, type SourceAdapter } from './sources/adapters';
import { type BlobStore, createBlobStore } from './storage/blob-store';

export const FIXTURES_DIR = 'evals/fixtures';

export type AppContext = {
  config: Config;
  db: Db;
  blobs: BlobStore;
  adapters: Record<AdapterType, SourceAdapter>;
  agents: Record<Market, PolicyAgent>;
};

export function modelSource(config: Config): ModelSource {
  return config.llmMode === 'replay'
    ? replayModels(fixtureExtractions(FIXTURES_DIR, 'expected.json'))
    : { kind: 'router', ...config.models };
}

export async function createContext(
  config: Config,
  overrides: { models?: ModelSource; adapters?: Record<AdapterType, SourceAdapter> } = {},
): Promise<AppContext> {
  const db = connect(config.databaseUrl);
  const blobs = createBlobStore(config);
  const models = overrides.models ?? modelSource(config);
  return {
    config,
    db,
    blobs,
    adapters: overrides.adapters ?? adapters,
    agents: { us: await createPolicyAgent({ market: 'us', models, sources: databaseSources(db, blobs) }) },
  };
}

export async function closeContext(ctx: AppContext): Promise<void> {
  await ctx.db.$disconnect();
}

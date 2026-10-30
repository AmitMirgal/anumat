import type { StorageConfig } from './config';
import { closeContext as closeFullContext } from './context';
import { createEngine as createFullEngine, type CreateEngineOptions, type EngineDb, type EngineFirecrawl, type EngineLlm, type EngineStorage } from './engine';

export type { CreateEngineOptions, EngineDb, EngineFirecrawl, EngineLlm, EngineStorage };

export type Engine = {
  config: {
    databaseUrl: string;
    storage: StorageConfig;
    models: { strong: string; cheap: string };
    firecrawlApiKey: string | undefined;
    firecrawlApiUrl: string | undefined;
  };
  db: EngineDb;
};

export async function createEngine(options: CreateEngineOptions): Promise<Engine> {
  return createFullEngine(options);
}

export async function closeContext(engine: Engine): Promise<void> {
  await closeFullContext(engine as Parameters<typeof closeFullContext>[0]);
}

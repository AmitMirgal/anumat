import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureExtractions, replayModels } from './agent/replay-model';
import type { ModelSource } from './agent/policy-agent';
import type { Config } from './config';

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../evals/fixtures');

export function modelSource(config: Config): ModelSource {
  return config.llmMode === 'replay'
    ? replayModels(fixtureExtractions(FIXTURES_DIR, 'expected.json'))
    : { kind: 'router', ...config.models };
}

export { fixtureExtractions, replayModels };

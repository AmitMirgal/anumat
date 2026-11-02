import { chdir } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config';

chdir(join(dirname(fileURLToPath(import.meta.url)), '../../../..'));
import { modelSource } from '../model-source';
import { closeContext, createContext } from '../context';
import { log } from '../log';
import { checkDueSources } from '../pipeline/check';

const config = loadConfig();
const ctx = await createContext(config, { models: modelSource(config) });
try {
  const results = await checkDueSources(ctx);
  const outcomes = Object.groupBy(results, (result) => result.run.outcome);
  log.info(
    {
      checked: results.length,
      unchanged: outcomes.unchanged?.length ?? 0,
      new_artifact: outcomes.new_artifact?.length ?? 0,
      error: outcomes.error?.length ?? 0,
    },
    'watch pass complete',
  );
} finally {
  await closeContext(ctx);
}

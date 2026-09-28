import { loadConfig } from '../config';
import { closeContext, createContext } from '../context';
import { log } from '../log';
import { checkDueSources } from '../pipeline/check';

const ctx = await createContext(loadConfig());
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

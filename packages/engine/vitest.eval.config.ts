import { existsSync } from 'node:fs';
import { MastraEvalsReporter } from '@mastra/evals/vitest';
import { defineConfig } from 'vitest/config';

for (const path of ['.env', '../../.env']) {
  if (!existsSync(path)) continue;
  process.loadEnvFile(path);
  break;
}

export default defineConfig({
  test: {
    include: ['evals/**/*.eval.ts'],
    reporters: ['default', new MastraEvalsReporter()],
    setupFiles: ['@mastra/evals/vitest/setup'],
    env: { LOG_LEVEL: 'silent' },
    fileParallelism: false,
    testTimeout: 600_000,
  },
});

import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

for (const path of ['.env', '../../.env']) {
  if (!existsSync(path)) continue;
  process.loadEnvFile(path);
  break;
}

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', '../../ee/**/*.test.ts'],
    env: { LOG_LEVEL: 'silent' },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

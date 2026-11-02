import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the published package ships NOTICE and one types entry', () => {
  expect(existsSync(join(root, 'dist/index.d.ts'))).toBe(true);
  expect(existsSync(join(root, 'dist/index.d.mts'))).toBe(false);
  const notice = readFileSync(join(root, 'NOTICE'), 'utf8');
  expect(notice).not.toMatch(/mastra/i);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[] };
  expect(pkg.files).toContain('NOTICE');
  const published = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    publishConfig: { exports: { '.': { import: { types: string }; require: { types: string } } } };
  };
  expect(published.publishConfig.exports['.'].import.types).toBe('./dist/index.d.ts');
  expect(published.publishConfig.exports['.'].require.types).toBe('./dist/index.d.cts');
});

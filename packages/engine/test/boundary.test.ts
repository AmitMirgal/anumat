import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { engineRoot } from './databases';

test('the boundary check rejects an ee import', async () => {
  execFileSync('node', ['scripts/check-boundary.mjs'], { cwd: engineRoot });
  const dir = await mkdtemp(join(tmpdir(), 'anumat-boundary-'));
  const imported = ['apps/api/src', 'ee', 'license-key.ts'].join('/');
  await writeFile(join(dir, 'bad.ts'), `import { x } from '${imported}';\n`);
  expect(() => execFileSync('node', [join(engineRoot, 'scripts/check-boundary.mjs'), dir])).toThrow();
  await rm(dir, { recursive: true, force: true });
});

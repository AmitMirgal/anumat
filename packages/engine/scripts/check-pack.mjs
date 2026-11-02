import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = mkdtempSync(join(tmpdir(), 'anumat-engine-pack-'));
try {
  const json = execFileSync('npm', ['pack', '--json', '--pack-destination', dir], { cwd: join(root, 'packages/engine'), encoding: 'utf8' });
  const filename = JSON.parse(json)[0].filename;
  execFileSync('node', [join(root, 'scripts/check-engine-tarball.mjs'), join(dir, filename)], { stdio: 'inherit' });
  execFileSync('pnpm', ['exec', 'attw', '--pack', join(dir, filename), '--format', 'ascii'], {
    cwd: join(root, 'packages/engine'),
    stdio: 'inherit',
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

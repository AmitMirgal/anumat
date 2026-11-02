import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageRoot, '../..');
const dir = mkdtempSync(join(tmpdir(), 'anumat-js-pack-'));
try {
  const json = execFileSync('npm', ['pack', '--json', '--pack-destination', dir], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  const filename = JSON.parse(json)[0].filename;
  const tarball = join(dir, filename);
  execFileSync('node', [join(repoRoot, 'scripts/check-engine-tarball.mjs'), tarball], { stdio: 'inherit' });
  execFileSync('pnpm', ['exec', 'attw', '--pack', tarball, '--format', 'ascii'], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

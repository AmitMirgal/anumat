import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = process.argv[2];
const licenseNames = new Set(['LICENSE', 'LICENSE.md', 'NOTICE', 'THIRD_PARTY_NOTICES']);
const forbiddenPath =
  /(^|\/)ee\/|(^|\/)packages\/(core|db|markets)(\/|$)|@anumat\/(core|db|markets)\/|(^|\/)(core|db|markets)\/src\//;

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function scanTree(root) {
  const files = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      files.push(path);
      if (name.endsWith('.map')) fail(`${path} is a source map`);
      const text = readFileSync(path);
      if (text.includes('apps/api/src/ee')) fail(`${path} embeds ee source`);
      if (licenseNames.has(name) && /mastra/i.test(text.toString('utf8'))) {
        fail(`${path} contains a forbidden framework name`);
      }
    }
  }
  walk(root);
  return files;
}

function scanPackage(root) {
  const manifestPath = join(root, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.scripts) fail('published package.json still has scripts');
  if (manifest.devDependencies) fail('published package.json still has devDependencies');
  const types = manifest.exports?.['.']?.import?.types;
  const requireTypes = manifest.exports?.['.']?.require?.types;
  if (types !== './dist/index.d.ts' || requireTypes !== './dist/index.d.cts') {
    fail('published exports do not split ESM and CJS types');
  }
  const files = scanTree(root);
  if (files.length === 0) fail('tarball contains no files');
  for (const file of files) {
    const relative = file.slice(root.length + 1);
    console.log(relative);
    if (forbiddenPath.test(relative)) fail(`tarball contains a private path: ${relative}`);
  }
}

if (arg?.endsWith('.tgz')) {
  const dir = mkdtempSync(join(tmpdir(), 'anumat-pack-'));
  try {
    execFileSync('tar', ['-xzf', arg, '-C', dir]);
    scanPackage(join(dir, 'package'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  const raw = arg ? readFileSync(arg, 'utf8') : readFileSync(0, 'utf8');
  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const files = entries.flatMap((entry) => entry.files ?? []);
  if (files.length === 0) fail('npm pack returned no files');
  for (const file of files) {
    const path = typeof file === 'string' ? file : file.path;
    console.log(path);
    if (typeof path === 'string' && forbiddenPath.test(path)) fail(`tarball contains a private path: ${path}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);

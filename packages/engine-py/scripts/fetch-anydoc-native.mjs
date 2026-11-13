#!/usr/bin/env node
/**
 * Place the target-platform @firecrawl/anydoc napi .node next to the sidecar.
 * bun compile cannot dlopen a native addon from $bunfs; NAPI-RS loads
 * NAPI_RS_NATIVE_LIBRARY_PATH from a real file.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ANYDOC_NATIVE_BY_BUN_TARGET = {
  'bun-darwin-arm64': { pkg: '@firecrawl/anydoc-darwin-arm64', file: 'anydoc.darwin-arm64.node' },
  'bun-darwin-x64': { pkg: '@firecrawl/anydoc-darwin-x64', file: 'anydoc.darwin-x64.node' },
  'bun-linux-x64': { pkg: '@firecrawl/anydoc-linux-x64-gnu', file: 'anydoc.linux-x64-gnu.node' },
  'bun-linux-arm64': { pkg: '@firecrawl/anydoc-linux-arm64-gnu', file: 'anydoc.linux-arm64-gnu.node' },
  'bun-windows-x64': { pkg: '@firecrawl/anydoc-win32-x64-msvc', file: 'anydoc.win32-x64-msvc.node' },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

export function anydocVersion(repo = root) {
  try {
    const require = createRequire(join(repo, 'packages/engine/package.json'));
    const installed = JSON.parse(readFileSync(require.resolve('@firecrawl/anydoc/package.json'), 'utf8'));
    if (typeof installed.version === 'string' && /^\d+\.\d+\.\d+/.test(installed.version)) {
      return installed.version;
    }
  } catch {
    // Fall through to the range in packages/engine/package.json.
  }
  const pkg = JSON.parse(readFileSync(join(repo, 'packages/engine/package.json'), 'utf8'));
  const raw = pkg.dependencies?.['@firecrawl/anydoc'];
  if (typeof raw !== 'string' || raw === '') {
    throw new Error('packages/engine/package.json is missing @firecrawl/anydoc');
  }
  const version = raw.replace(/^[^\d]*/, '');
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`cannot parse @firecrawl/anydoc version from ${raw}`);
  }
  return version;
}

function findInNodeModules(npmPkg, file) {
  try {
    const require = createRequire(join(root, 'packages/engine/package.json'));
    const pkgJson = require.resolve(`${npmPkg}/package.json`);
    const nodePath = join(dirname(pkgJson), file);
    if (existsSync(nodePath)) return nodePath;
  } catch {
    // pnpm does not let the engine package require optional platform addons.
  }
  const pnpmDir = join(root, 'node_modules/.pnpm');
  if (!existsSync(pnpmDir)) return null;
  const prefix = `${npmPkg.replace(/^@/, '').replace('/', '+')}@`;
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith(prefix)) continue;
    const nodePath = join(pnpmDir, entry, 'node_modules', npmPkg, file);
    if (existsSync(nodePath)) return nodePath;
  }
  return null;
}

function npmPackNode(npmPkg, file, version) {
  const dir = mkdtempSync(join(tmpdir(), 'anydoc-native-'));
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const packed = spawnSync(npm, ['pack', `${npmPkg}@${version}`, '--pack-destination', dir], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (packed.status !== 0) {
      process.stderr.write(packed.stderr || packed.stdout || 'npm pack failed\n');
      throw new Error(`npm pack ${npmPkg}@${version} failed`);
    }
    const tgz = readdirSync(dir).find((name) => name.endsWith('.tgz'));
    if (!tgz) throw new Error(`npm pack did not write a tarball in ${dir}`);
    // GNU tar treats C: in an absolute Windows path as a remote host.
    // Extract by tarball basename with cwd set to the temp dir.
    const tarArgs = process.platform === 'win32' ? ['--force-local', '-xzf', tgz] : ['-xzf', tgz];
    const extracted = spawnSync('tar', tarArgs, { cwd: dir, encoding: 'utf8' });
    if (extracted.status !== 0) {
      process.stderr.write(extracted.stderr || extracted.stdout || 'tar failed\n');
      throw new Error(`failed to extract ${tgz}`);
    }
    const nodePath = join(dir, 'package', file);
    if (!existsSync(nodePath)) {
      throw new Error(`${npmPkg}@${version} is missing ${file}`);
    }
    return { nodePath, cleanup: dir };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

export function fetchAnydocNative(target, dest) {
  const spec = ANYDOC_NATIVE_BY_BUN_TARGET[target];
  if (!spec) throw new Error(`no @firecrawl/anydoc native package for bun target ${target}`);
  const version = anydocVersion();
  let source = findInNodeModules(spec.pkg, spec.file);
  let cleanup = null;
  if (!source) {
    const packed = npmPackNode(spec.pkg, spec.file, version);
    source = packed.nodePath;
    cleanup = packed.cleanup;
  }
  copyFileSync(source, dest);
  if (cleanup) rmSync(cleanup, { recursive: true, force: true });
  return dest;
}

const invokedAsScript =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  const target = process.argv[2];
  const dest = process.argv[3];
  if (!target || !dest) {
    console.error('Usage: fetch-anydoc-native.mjs <bun-target> <dest-anydoc.node>');
    process.exit(1);
  }
  fetchAnydocNative(target, dest);
  console.log(`wrote ${dest} for ${target}`);
}

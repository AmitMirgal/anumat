import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const skip = new Set(['node_modules', 'dist', 'migrations', 'coverage']);
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts']);
const eeImport = /apps\/api\/src\/ee|['"][^'"]*\/ee\/[^'"]*['"]/;

const root = process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..');
let failed = false;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!extensions.has(extname(name))) continue;
    if (!eeImport.test(readFileSync(path, 'utf8'))) continue;
    console.error(`${path} imports ee/`);
    failed = true;
  }
}

walk(root);
if (failed) process.exit(1);

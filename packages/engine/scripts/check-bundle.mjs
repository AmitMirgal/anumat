import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const privatePackage = /@anumat\/(core|db|markets)/;
const privateImport = /(?:from|import|require)\s*\(?\s*['"]@anumat\/(core|db|markets)['"]/;
const eeImport = /apps\/api\/src\/ee|['"][^'"]*\/ee\/[^'"]*['"]/;
let failed = false;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    const text = readFileSync(path, 'utf8');
    const declaration = name.endsWith('.d.ts') || name.endsWith('.d.mts') || name.endsWith('.d.cts');
    if (declaration && privatePackage.test(text)) {
      console.error(`${path} references a private workspace package`);
      failed = true;
    }
    if (!declaration && privateImport.test(text)) {
      console.error(`${path} imports a private workspace package`);
      failed = true;
    }
    if (eeImport.test(text)) {
      console.error(`${path} imports ee/`);
      failed = true;
    }
  }
}

walk(dist);
if (failed) process.exit(1);

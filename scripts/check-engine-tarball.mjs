import { readFileSync } from 'node:fs';

const raw = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : readFileSync(0, 'utf8');
const parsed = JSON.parse(raw);
const entries = Array.isArray(parsed) ? parsed : [parsed];
const files = entries.flatMap((entry) => entry.files ?? []);
const forbidden =
  /(^|\/)ee\/|(^|\/)packages\/(core|db|markets)(\/|$)|@anumat\/(core|db|markets)\/|(^|\/)(core|db|markets)\/src\//;

if (files.length === 0) {
  console.error('npm pack returned no files');
  process.exit(1);
}

let failed = false;
for (const file of files) {
  const path = typeof file === 'string' ? file : file.path;
  console.log(path);
  if (typeof path === 'string' && forbidden.test(path)) {
    console.error(`tarball contains a private path: ${path}`);
    failed = true;
  }
}

if (failed) process.exit(1);

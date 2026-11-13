import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const target = process.argv[2];
const outfile = process.argv[3];
if (!target || !outfile) {
  console.error('Usage: compile-sidecar.ts <bun-target> <outfile>');
  process.exit(1);
}

const bundled = spawnSync('node', ['scripts/bundle-sidecar.mjs'], {
  cwd: join(root, 'packages/engine'),
  encoding: 'utf8',
});
if (bundled.status !== 0) {
  process.stderr.write(bundled.stderr);
  process.exit(bundled.status ?? 1);
}
const entry = bundled.stdout.trim();
assertNoBuildPath('prebundled sidecar', readFileSync(entry), root);

// bun compile stores JS on $bunfs. dlopen cannot load a napi .node from
// there, so --asset / embedding the binding inside the binary does not work.
// Ship anydoc.node next to the executable and point NAPI-RS at that real path.
const nativeDest = join(dirname(outfile), 'anydoc.node');
mkdirSync(dirname(nativeDest), { recursive: true });
const fetched = spawnSync(
  'node',
  [join(root, 'packages/engine-py/scripts/fetch-anydoc-native.mjs'), target, nativeDest],
  { encoding: 'utf8' },
);
if (fetched.status !== 0) {
  process.stderr.write(fetched.stderr);
  process.stderr.write(fetched.stdout);
  process.exit(fetched.status ?? 1);
}
process.stdout.write(fetched.stdout);

const compileEntry = join(dirname(entry), 'compile-entry.mjs');
writeFileSync(
  compileEntry,
  `import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

if (!process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
  const candidate = join(dirname(process.execPath), 'anydoc.node');
  if (existsSync(candidate)) process.env.NAPI_RS_NATIVE_LIBRARY_PATH = candidate;
}

await import('./sidecar.mjs');
`,
);

const stub = join(root, 'packages/engine/src/optional/empty.ts');
const result = await Bun.build({
  entrypoints: [compileEntry],
  compile: {
    target,
    outfile,
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
  plugins: [
    {
      name: 'optional-import',
      setup(build) {
        // Match only this module. A catch-all onResolve that returns undefined
        // makes Bun 1.4.0 drop a declaration that is still referenced, so
        // createPolicyAgent throws ReferenceError: Agent is not defined.
        build.onResolve({ filter: /^@opentelemetry\/api$/ }, () => ({ path: stub }));
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const produced = existsSync(outfile) ? outfile : `${outfile}.exe`;
if (!existsSync(produced)) {
  console.error(`Compile did not write ${outfile}`);
  process.exit(1);
}
assertNoBuildPath('compiled sidecar', readFileSync(produced), root);

function pathNeedles(repoRoot: string): Buffer[] {
  const forms = [repoRoot];
  for (const flag of ['-w', '-m']) {
    const converted = spawnSync('cygpath', [flag, repoRoot], { encoding: 'utf8' });
    if (converted.error || converted.status !== 0) continue;
    const form = converted.stdout.trim();
    if (!form) continue;
    forms.push(form, form.replaceAll('\\', '\\\\'));
  }
  return [...new Set(forms)].filter((form) => form.length > 0).map((form) => Buffer.from(form));
}

function assertNoBuildPath(label: string, bytes: Buffer, repoRoot: string): void {
  for (const needle of pathNeedles(repoRoot)) {
    if (bytes.includes(needle)) {
      console.error(`${label} contains the repo root path ${needle.toString('utf8')}`);
      process.exit(1);
    }
  }
  const folded = Buffer.from(bytes.toString('latin1').toLowerCase(), 'latin1');
  if (folded.includes(Buffer.from('amitmirgal'))) {
    console.error(`${label} contains a local username`);
    process.exit(1);
  }
}

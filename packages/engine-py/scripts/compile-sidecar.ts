import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
const bundledSource = readFileSync(entry, 'utf8');
if (hasLocalPath(bundledSource)) {
  console.error('prebundled sidecar contains a local path or username');
  process.exit(1);
}

const stub = join(root, 'packages/engine/src/optional/empty.ts');
const result = await Bun.build({
  entrypoints: [entry],
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
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.path !== '@opentelemetry/api') return undefined;
          return { path: stub };
        });
      },
    },
  ],
});

function hasLocalPath(text: string): boolean {
  return text.includes('/Users') || text.includes('/home') || text.includes('C:\\Users') || text.toLowerCase().includes('amitmirgal');
}

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

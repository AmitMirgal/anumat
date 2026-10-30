import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const target = process.argv[2];
const outfile = process.argv[3];
if (!target || !outfile) {
  console.error('Usage: compile-sidecar.ts <bun-target> <outfile>');
  process.exit(1);
}

const optional = new Set(['@opentelemetry/api']);
const stub = join(root, 'packages/engine/src/optional/empty.ts');

const result = await Bun.build({
  entrypoints: [join(root, 'packages/engine/src/sidecar.ts')],
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
          if (!optional.has(args.path)) return undefined;
          return { path: stub };
        });
      },
    },
  ],
});

if (!result.success) process.exit(1);

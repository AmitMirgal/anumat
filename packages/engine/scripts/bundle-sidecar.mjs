import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const outdir = join(root, 'packages/engine/.sidecar');
mkdirSync(outdir, { recursive: true });
const outfile = join(outdir, 'sidecar.mjs');
const stub = join(root, 'packages/engine/src/optional/empty.ts');

await esbuild.build({
  entryPoints: [join(root, 'packages/engine/src/sidecar.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  sourcemap: false,
  legalComments: 'none',
  define: {
    __dirname: 'import.meta.dirname',
    __filename: 'import.meta.filename',
  },
  external: ['@prisma/client', '@prisma/adapter-pg', 'pg', '@aws-sdk/client-s3', '@mastra/core', '@firecrawl/anydoc'],
  plugins: [
    {
      name: 'optional-otel',
      setup(build) {
        build.onResolve({ filter: /^@opentelemetry\/api$/ }, () => ({ path: stub }));
        build.onLoad({ filter: /sidecar-migrate\.ts$/ }, (args) => {
          const source = readFileSync(args.path, 'utf8');
          const sql = readFileSync(join(root, 'packages/db/prisma/migrations/20260929061425_init/migration.sql'), 'utf8');
          const contents = source
            .replace(/import migrationFile from '[^']+' with \{ type: 'file' \};/, () => `const migrationSql = ${JSON.stringify(sql)};`)
            .replace('await readFile(migrationFile)', 'migrationSql');
          return { contents, loader: 'ts' };
        });
      },
    },
  ],
});

process.stdout.write(outfile);

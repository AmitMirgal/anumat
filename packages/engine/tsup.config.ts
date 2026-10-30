import { defineConfig, type Options } from 'tsup';

const shared: Options = {
  noExternal: ['@anumat/core', '@anumat/db', '@anumat/markets'],
  platform: 'node',
  target: 'node24',
  sourcemap: false,
  splitting: false,
};

export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/publish.ts' },
    format: ['esm', 'cjs'],
    dts: false,
    shims: true,
    clean: false,
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.js' };
    },
  },
  {
    ...shared,
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);

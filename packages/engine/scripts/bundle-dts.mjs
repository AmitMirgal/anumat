import { rollup } from 'rollup';
import dts from 'rollup-plugin-dts';

const bundledPackage = /\/packages\/(engine|core|db|markets)\//;

const bundle = await rollup({
  input: 'src/publish.ts',
  external(id) {
    const path = id.replaceAll('\\', '/');
    if (path.includes('/generated/prisma')) return true;
    if (path.startsWith('\0')) return false;
    if (bundledPackage.test(path)) return false;
    if (path.startsWith('@anumat/core') || path.startsWith('@anumat/db') || path.startsWith('@anumat/markets')) return false;
    if (path.startsWith('.') || path.startsWith('/')) return path.includes('/node_modules/');
    return true;
  },
  plugins: [dts({ respectExternal: true, tsconfig: 'tsconfig.json' })],
});

await bundle.write({ file: 'dist/index.d.ts', format: 'es' });
await bundle.write({ file: 'dist/index.d.cts', format: 'es' });
await bundle.close();

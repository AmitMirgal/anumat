import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const roots = ['packages', 'apps'].map((dir) => join(repoRoot, dir));
const skip = new Set(['node_modules', 'dist', 'generated', '.turbo']);

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return typescriptFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

function importsEnterpriseEdition(source: string): boolean {
  return source.split('\n').some((line) => {
    const code = line.replace(/\/\/.*$/, '');
    return /(?:from|import)\s*\(?\s*['"][^'"]*\bee\//.test(code);
  });
}

test('open core does not import the Enterprise Edition', () => {
  const hits = roots.flatMap(typescriptFiles).filter((path) => importsEnterpriseEdition(readFileSync(path, 'utf8')));
  expect(hits).toEqual([]);
});

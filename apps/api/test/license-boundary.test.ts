import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const skip = new Set(['node_modules', 'dist', 'generated', '.turbo', '.git']);

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name) || name === 'ee') return [];
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
  const hits = typescriptFiles(repoRoot).filter((path) => importsEnterpriseEdition(readFileSync(path, 'utf8')));
  expect(hits).toEqual([]);
});

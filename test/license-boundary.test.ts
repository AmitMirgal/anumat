import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const roots = ['src', 'scripts', 'evals', 'test'];

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
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

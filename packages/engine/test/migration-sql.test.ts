import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { normalizeMigrationSql } from '../scripts/migration-sql.mjs';

test('embedded migration SQL is LF and the wheel jobs compare one checksum', () => {
  expect(normalizeMigrationSql('select 1;\r\nselect 2;\r\n')).toBe('select 1;\nselect 2;\n');
  const bundle = readFileSync(new URL('../scripts/bundle-sidecar.mjs', import.meta.url), 'utf8');
  expect(bundle).toContain('normalizeMigrationSql');
  expect(bundle).toContain('migration.sha256');
  const wheel = readFileSync(new URL('../../engine-py/scripts/build-wheel.sh', import.meta.url), 'utf8');
  expect(wheel).toContain('migration.sha256');
  const attributes = readFileSync(new URL('../../../.gitattributes', import.meta.url), 'utf8');
  expect(attributes).toContain('*.sql text eol=lf');
  expect(attributes).toContain('*.prisma text eol=lf');
  const workflow = readFileSync(new URL('../../../.github/workflows/engine-wheels.yml', import.meta.url), 'utf8');
  expect(workflow).toContain('anumat-engine-migration-sha-');
  expect(workflow).toContain('expected 5 migration checksums');
});

test('the bun sidecar plugin does not fall through every import', () => {
  const source = readFileSync(new URL('../../engine-py/scripts/compile-sidecar.ts', import.meta.url), 'utf8');
  expect(source).toContain('filter: /^@opentelemetry\\/api$/');
  expect(source).not.toContain('filter: /.*/');
});

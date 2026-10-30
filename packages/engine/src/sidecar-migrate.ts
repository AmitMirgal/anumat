import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import migrationFile from '../../db/prisma/migrations/20260929061425_init/migration.sql' with { type: 'file' };
import { applyMigrations, type MigrateResult } from './migrate';

const MIGRATION_NAME = '20260929061425_init';

export async function runBundledMigrations(databaseUrl: string): Promise<MigrateResult> {
  const root = await mkdtemp(join(tmpdir(), 'anumat-engine-migrations-'));
  try {
    const directory = join(root, MIGRATION_NAME);
    await mkdir(directory);
    await writeFile(join(directory, 'migration.sql'), await readFile(migrationFile));
    return await applyMigrations(databaseUrl, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

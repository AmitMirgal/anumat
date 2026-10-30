import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { applyMigrations } from '../src/migrate';
import { engineRoot, migrationChecksum, migrationsDir, prismaMigrateDeploy, recreateDatabase } from './databases';

test('applyMigrations matches prisma migrate deploy and can run twice', async () => {
  const ours = await recreateDatabase('anumat_engine_ours');
  const prismaDb = await recreateDatabase('anumat_engine_prisma');
  expect((await applyMigrations(ours, migrationsDir)).applied).toEqual(['20260929061425_init']);
  expect((await applyMigrations(ours, migrationsDir)).applied).toEqual([]);
  prismaMigrateDeploy(prismaDb);
  expect(await migrationChecksum(ours)).toBe(await migrationChecksum(prismaDb));
  expect((await applyMigrations(prismaDb, migrationsDir)).applied).toEqual([]);
  expect(prismaMigrateDeploy(ours)).not.toContain('Applying migration');
});

test('anumat migrate --db applies shipped migrations and ignores DATABASE_URL', async () => {
  execFileSync('node', ['scripts/copy-migrations.mjs'], { cwd: engineRoot });
  const databaseUrl = await recreateDatabase('anumat_engine_cli');
  const output = execFileSync('pnpm', ['exec', 'tsx', 'src/cli.ts', 'migrate', '--db', databaseUrl], {
    cwd: engineRoot,
    env: { ...process.env, DATABASE_URL: 'postgres://anumat:anumat@127.0.0.1:1/wrong' },
    encoding: 'utf8',
  });
  expect(output).toContain('Applied 20260929061425_init');
  const repeat = execFileSync('pnpm', ['exec', 'tsx', 'src/cli.ts', 'migrate', `--db=${databaseUrl}`], {
    cwd: engineRoot,
    env: { ...process.env, DATABASE_URL: 'postgres://anumat:anumat@127.0.0.1:1/wrong' },
    encoding: 'utf8',
  });
  expect(repeat).toContain('No pending migrations to apply.');
});

test('anumat migrate requires --db even when DATABASE_URL is set', () => {
  let stderr = '';
  try {
    execFileSync('pnpm', ['exec', 'tsx', 'src/cli.ts', 'migrate'], {
      cwd: engineRoot,
      env: { ...process.env, DATABASE_URL: 'postgres://anumat:anumat@127.0.0.1:5432/anumat' },
      encoding: 'utf8',
    });
  } catch (error) {
    const failed = error as { status?: number; stderr?: string };
    expect(failed.status).toBe(1);
    stderr = failed.stderr ?? '';
  }
  expect(stderr).toContain('Usage: anumat migrate --db <url>');
});

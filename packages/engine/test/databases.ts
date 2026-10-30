import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const adminUrl = 'postgres://anumat:anumat@127.0.0.1:5432/anumat';
const names = ['anumat_engine_api', 'anumat_engine_ours', 'anumat_engine_prisma', 'anumat_engine_cli'] as const;
export type EngineDatabaseName = (typeof names)[number];

export const engineRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = join(engineRoot, '../..');
export const migrationsDir = join(repoRoot, 'packages/db/prisma/migrations');

export async function recreateDatabase(name: EngineDatabaseName): Promise<string> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`);
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name} OWNER anumat`);
  } finally {
    await admin.end();
  }
  return `postgres://anumat:anumat@127.0.0.1:5432/${name}`;
}

export async function migrationChecksum(databaseUrl: string): Promise<string> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ checksum: string }>('SELECT checksum FROM "_prisma_migrations"');
    const checksum = result.rows[0]?.checksum;
    if (!checksum) throw new Error('no migration checksum');
    return checksum;
  } finally {
    await client.end();
  }
}

export function prismaMigrateDeploy(databaseUrl: string): string {
  return execFileSync('pnpm', ['--filter', '@anumat/db', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
}

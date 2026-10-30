import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

const LOCK_KEY = 872394821;

type AppliedMigration = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

export type MigrateResult = { applied: string[] };

export async function applyMigrations(databaseUrl: string, migrationsDir: string): Promise<MigrateResult> {
  if (!URL.canParse(databaseUrl)) throw new Error('database url must be a URL');
  const local = await readLocalMigrations(migrationsDir);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" VARCHAR(36) PRIMARY KEY NOT NULL,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )
    `);
    const recorded = await client.query<AppliedMigration>(
      'SELECT "migration_name", "checksum", "finished_at", "rolled_back_at" FROM "_prisma_migrations"',
    );
    const appliedNames = finishedNames(recorded.rows);
    for (const name of appliedNames) {
      if (!local.has(name)) {
        throw new Error(`Database has migration ${name}, which is missing from ${migrationsDir}`);
      }
    }
    const applied: string[] = [];
    for (const [name, migration] of local) {
      const rows = recorded.rows.filter((row) => row.migration_name === name && row.rolled_back_at === null);
      const finished = rows.find((row) => row.finished_at !== null);
      const failed = rows.find((row) => row.finished_at === null);
      if (failed) throw new Error(`Migration ${name} is recorded as failed. Resolve it before deploying again.`);
      if (finished) {
        if (finished.checksum !== migration.checksum) {
          throw new Error(`Migration ${name} was already applied with a different checksum`);
        }
        continue;
      }
      await applyOne(client, name, migration);
      applied.push(name);
    }
    return { applied };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

async function readLocalMigrations(migrationsDir: string): Promise<Map<string, { checksum: string; sql: string }>> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const local = new Map<string, { checksum: string; sql: string }>();
  for (const name of names) {
    const sql = await readFile(join(migrationsDir, name, 'migration.sql'));
    local.set(name, { checksum: createHash('sha256').update(sql).digest('hex'), sql: sql.toString('utf8') });
  }
  return local;
}

function finishedNames(rows: AppliedMigration[]): Set<string> {
  return new Set(rows.filter((row) => row.finished_at !== null && row.rolled_back_at === null).map((row) => row.migration_name));
}

async function applyOne(
  client: Client,
  name: string,
  migration: { checksum: string; sql: string },
): Promise<void> {
  const id = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "applied_steps_count") VALUES ($1, $2, $3, NOW(), 0)',
      [id, migration.checksum, name],
    );
    await client.query(migration.sql);
    await client.query('UPDATE "_prisma_migrations" SET "finished_at" = NOW(), "applied_steps_count" = 1 WHERE "id" = $1', [id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

import { createHash } from 'node:crypto';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { registerPayer, registerSource } from '../../src/catalog';
import { connect, type Db, one } from '../../src/db/client';
import { policyArtifacts, policyDocuments } from '../../src/db/schema';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://anumat:anumat@127.0.0.1:5432/anumat_test';

export async function testDb() {
  const { db, sql } = connect(TEST_DATABASE_URL);
  await migrate(db, { migrationsFolder: 'drizzle' });
  return {
    db,
    sql,
    reset: () =>
      sql`truncate table watch_runs, policy_diffs, policy_versions, policy_documents, policy_artifacts, policy_sources, payers cascade`,
    close: () => sql.end(),
  };
}

export async function seedSource(db: Db, sourceUrl = 'https://payer.test/bariatric-surgery.pdf') {
  const payer = await registerPayer(db, { name: 'UnitedHealthcare', slug: 'uhc', market: 'us' });
  return registerSource(db, { payerId: payer.id, title: 'Bariatric Surgery', sourceUrl });
}

export async function seedDocument(db: Db, sourceId: string, content: string) {
  const sha = createHash('sha256').update(content).digest('hex');
  const artifact = one(
    await db
      .insert(policyArtifacts)
      .values({ sourceId, contentSha256: sha, storagePath: `pdf/${sha}.pdf`, mime: 'application/pdf', byteSize: content.length })
      .returning(),
  );
  return one(
    await db
      .insert(policyDocuments)
      .values({ artifactId: artifact.id, status: 'converted', converter: 'anydoc', markdownPath: `markdown/${sha}.md` })
      .returning(),
  );
}

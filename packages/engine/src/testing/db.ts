import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registerPayer, registerSource } from '../catalog';
import { connect, type Db } from '@anumat/db';

const execFileAsync = promisify(execFile);

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://anumat:anumat@127.0.0.1:5432/anumat_test';

let migrated = false;

async function migrateTestDatabase() {
  if (migrated) return;
  await execFileAsync('pnpm', ['--filter', '@anumat/db', 'exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  migrated = true;
}

export async function testDb() {
  await migrateTestDatabase();
  const db = connect(TEST_DATABASE_URL);
  return {
    db,
    sql: db.$queryRaw.bind(db),
    reset: () =>
      db.$executeRaw`TRUNCATE TABLE watch_runs, policy_diffs, policy_versions, policy_documents, policy_artifacts, policy_sources, payers CASCADE`,
    close: () => db.$disconnect(),
  };
}

export async function seedSource(db: Db, sourceUrl = 'https://payer.test/bariatric-surgery.pdf') {
  const payer = await registerPayer(db, { name: 'UnitedHealthcare', slug: 'uhc', market: 'us' });
  return registerSource(db, { payerId: payer.id, title: 'Bariatric Surgery', sourceUrl });
}

export async function seedDocument(db: Db, sourceId: string, content: string) {
  const sha = createHash('sha256').update(content).digest('hex');
  const artifact = await db.policyArtifact.create({
    data: {
      sourceId,
      contentSha256: sha,
      storagePath: `pdf/${sha}.pdf`,
      mime: 'application/pdf',
      byteSize: content.length,
    },
  });
  return db.policyDocument.create({
    data: {
      artifactId: artifact.id,
      status: 'converted',
      converter: 'anydoc',
      markdownPath: `markdown/${sha}.md`,
    },
  });
}

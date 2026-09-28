import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { type Db, one, type Tx } from './db/client';
import { policyDiffs, policySources, policyVersions } from './db/schema';
import { AppError } from './errors';
import { markets } from './markets/registry';
import { decodeCursor, numberCursor, type Page, type PageRequest, timeCursor, toPage } from './pagination';

export type PolicyVersion = typeof policyVersions.$inferSelect;
export type PolicyDiff = typeof policyDiffs.$inferSelect;
export type VersionStatus = PolicyVersion['status'];

async function lockSource(tx: Tx, sourceId: string) {
  const [source] = await tx.select().from(policySources).where(eq(policySources.id, sourceId)).for('update');
  if (!source) throw new AppError('not_found', `Source ${sourceId} not found`);
  return source;
}

async function lockVersion(tx: Tx, versionId: string): Promise<PolicyVersion> {
  const [row] = await tx
    .select({ sourceId: policyVersions.sourceId })
    .from(policyVersions)
    .where(eq(policyVersions.id, versionId));
  if (!row) throw new AppError('not_found', `Version ${versionId} not found`);
  await lockSource(tx, row.sourceId);
  return one(await tx.select().from(policyVersions).where(eq(policyVersions.id, versionId)));
}

async function latestApproved(db: Db | Tx, policyKey: string): Promise<PolicyVersion | undefined> {
  const [row] = await db
    .select()
    .from(policyVersions)
    .where(and(eq(policyVersions.policyKey, policyKey), eq(policyVersions.status, 'approved')))
    .orderBy(desc(policyVersions.version))
    .limit(1);
  return row;
}

export async function diffForVersion(db: Db | Tx, versionId: string): Promise<PolicyDiff> {
  const [diff] = await db.select().from(policyDiffs).where(eq(policyDiffs.toVersionId, versionId));
  if (!diff) throw new AppError('not_found', `No diff for version ${versionId}`);
  return diff;
}

export async function proposeVersion(
  db: Db,
  input: { sourceId: string; documentId: string; extraction: unknown; extractedBy: string },
): Promise<{ version: PolicyVersion; diff: PolicyDiff; created: boolean }> {
  return db.transaction(async (tx) => {
    const source = await lockSource(tx, input.sourceId);
    const [existing] = await tx.select().from(policyVersions).where(eq(policyVersions.documentId, input.documentId));
    if (existing) return { version: existing, diff: await diffForVersion(tx, existing.id), created: false };

    const market = markets[source.market];
    const parsed = market.extractSchema.safeParse(input.extraction);
    if (!parsed.success) {
      throw new AppError('extraction_invalid', 'The extraction does not match the market schema', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }

    const base = await latestApproved(tx, source.policyKey);
    const [superseded] = await tx
      .update(policyVersions)
      .set({ status: 'superseded', supersededAt: new Date() })
      .where(and(eq(policyVersions.policyKey, source.policyKey), eq(policyVersions.status, 'proposed')))
      .returning();
    const version = one(
      await tx
        .insert(policyVersions)
        .values({
          sourceId: source.id,
          market: source.market,
          policyKey: source.policyKey,
          documentId: input.documentId,
          baseVersionId: base?.id ?? null,
          supersedesId: superseded?.id ?? null,
          extractSchema: market.schemaId,
          extractedJson: parsed.data,
          extractedBy: input.extractedBy,
        })
        .returning(),
    );
    const changes = market.diff(base ? market.extractSchema.parse(base.extractedJson) : null, parsed.data);
    const diff = one(
      await tx
        .insert(policyDiffs)
        .values({ policyKey: source.policyKey, fromVersionId: base?.id ?? null, toVersionId: version.id, diffJson: changes })
        .returning(),
    );
    return { version, diff, created: true };
  });
}

export async function approveVersion(db: Db, input: { versionId: string; approvedBy: string }): Promise<PolicyVersion> {
  return db.transaction(async (tx) => {
    const version = await lockVersion(tx, input.versionId);
    if (version.status === 'approved') return version;
    if (version.status !== 'proposed') {
      throw new AppError('version_not_proposed', `Version ${version.id} is ${version.status} and cannot be approved`, {
        status: version.status,
      });
    }
    const base = await latestApproved(tx, version.policyKey);
    if ((base?.id ?? null) !== version.baseVersionId) {
      throw new AppError('stale_proposal', `Version ${version.id} was diffed against a version that is no longer the latest`, {
        base_version_id: version.baseVersionId,
        latest_approved_version_id: base?.id ?? null,
      });
    }
    return one(
      await tx
        .update(policyVersions)
        .set({ status: 'approved', version: (base?.version ?? 0) + 1, approvedAt: new Date(), approvedBy: input.approvedBy })
        .where(and(eq(policyVersions.id, version.id), eq(policyVersions.status, 'proposed')))
        .returning(),
    );
  });
}

export async function rejectVersion(
  db: Db,
  input: { versionId: string; rejectedBy: string; reason: string },
): Promise<PolicyVersion> {
  return db.transaction(async (tx) => {
    const version = await lockVersion(tx, input.versionId);
    if (version.status === 'rejected') return version;
    if (version.status !== 'proposed') {
      throw new AppError('version_not_proposed', `Version ${version.id} is ${version.status} and cannot be rejected`, {
        status: version.status,
      });
    }
    return one(
      await tx
        .update(policyVersions)
        .set({ status: 'rejected', rejectedAt: new Date(), rejectedBy: input.rejectedBy, rejectReason: input.reason })
        .where(and(eq(policyVersions.id, version.id), eq(policyVersions.status, 'proposed')))
        .returning(),
    );
  });
}

async function assertPolicyExists(db: Db, policyKey: string) {
  const [source] = await db
    .select({ id: policySources.id })
    .from(policySources)
    .where(eq(policySources.policyKey, policyKey));
  if (!source) throw new AppError('not_found', `Policy ${policyKey} not found`);
}

export async function getPublishedPolicy(db: Db, policyKey: string): Promise<PolicyVersion> {
  const latest = await latestApproved(db, policyKey);
  if (latest) return latest;
  await assertPolicyExists(db, policyKey);
  throw new AppError('policy_not_published', `Policy ${policyKey} has no approved version yet`);
}

export async function getPublishedVersion(db: Db, policyKey: string, version: number): Promise<PolicyVersion> {
  const [row] = await db
    .select()
    .from(policyVersions)
    .where(
      and(eq(policyVersions.policyKey, policyKey), eq(policyVersions.status, 'approved'), eq(policyVersions.version, version)),
    );
  if (!row) throw new AppError('not_found', `Policy ${policyKey} has no approved version ${version}`);
  return row;
}

export async function listPublishedVersions(db: Db, policyKey: string, page: PageRequest): Promise<Page<PolicyVersion>> {
  await assertPolicyExists(db, policyKey);
  const before = page.cursor ? decodeCursor(page.cursor, numberCursor)[0] : undefined;
  const rows = await db
    .select()
    .from(policyVersions)
    .where(
      and(
        eq(policyVersions.policyKey, policyKey),
        eq(policyVersions.status, 'approved'),
        before === undefined ? undefined : lt(policyVersions.version, before),
      ),
    )
    .orderBy(desc(policyVersions.version))
    .limit(page.limit + 1);
  return toPage(rows, page.limit, (row) => [row.version ?? 0]);
}

export async function getVersion(db: Db, id: string): Promise<PolicyVersion> {
  const [row] = await db.select().from(policyVersions).where(eq(policyVersions.id, id));
  if (!row) throw new AppError('not_found', `Version ${id} not found`);
  return row;
}

export async function listVersions(
  db: Db,
  filter: { status?: VersionStatus | undefined; policyKey?: string | undefined },
  page: PageRequest,
): Promise<Page<PolicyVersion>> {
  const before = page.cursor ? decodeCursor(page.cursor, timeCursor) : undefined;
  const rows = await db
    .select()
    .from(policyVersions)
    .where(
      and(
        filter.status ? eq(policyVersions.status, filter.status) : undefined,
        filter.policyKey ? eq(policyVersions.policyKey, filter.policyKey) : undefined,
        before
          ? sql`(${policyVersions.createdAt}, ${policyVersions.id}) < (${before[0]}::timestamptz, ${before[1]}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(policyVersions.createdAt), desc(policyVersions.id))
    .limit(page.limit + 1);
  return toPage(rows, page.limit, (row) => [row.createdAt.toISOString(), row.id]);
}

export async function saveDiffNotes(
  db: Db,
  diffId: string,
  notes: { summary: string | null; review: unknown },
): Promise<PolicyDiff> {
  return one(
    await db
      .update(policyDiffs)
      .set({ summary: notes.summary, review: notes.review })
      .where(eq(policyDiffs.id, diffId))
      .returning(),
  );
}

export async function getDiff(db: Db, id: string): Promise<PolicyDiff> {
  const [diff] = await db.select().from(policyDiffs).where(eq(policyDiffs.id, id));
  if (!diff) throw new AppError('not_found', `Diff ${id} not found`);
  return diff;
}

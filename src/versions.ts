import { jsonInput, type Db, type Tx } from './db/client';
import { Prisma, type PolicyDiff, type PolicyVersion, type VersionStatus } from './generated/prisma/client';
import { AppError } from './errors';
import { markets } from './markets/registry';
import { decodeCursor, numberCursor, type Page, type PageRequest, timeCursor, toPage } from './pagination';

export type { PolicyDiff, PolicyVersion, VersionStatus };

async function lockSource(tx: Tx, sourceId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM policy_sources WHERE id = CAST(${sourceId} AS uuid) FOR UPDATE
  `;
  if (locked.length === 0) throw new AppError('not_found', `Source ${sourceId} not found`);
  const source = await tx.policySource.findUnique({ where: { id: sourceId } });
  if (!source) throw new AppError('not_found', `Source ${sourceId} not found`);
  return source;
}

async function lockVersion(tx: Tx, versionId: string): Promise<PolicyVersion> {
  const row = await tx.policyVersion.findUnique({ where: { id: versionId }, select: { sourceId: true } });
  if (!row) throw new AppError('not_found', `Version ${versionId} not found`);
  await lockSource(tx, row.sourceId);
  const version = await tx.policyVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new AppError('not_found', `Version ${versionId} not found`);
  return version;
}

async function latestApproved(db: Db | Tx, policyKey: string): Promise<PolicyVersion | null> {
  return db.policyVersion.findFirst({
    where: { policyKey, status: 'approved' },
    orderBy: { version: 'desc' },
  });
}

export async function diffForVersion(db: Db | Tx, versionId: string): Promise<PolicyDiff> {
  const diff = await db.policyDiff.findUnique({ where: { toVersionId: versionId } });
  if (!diff) throw new AppError('not_found', `No diff for version ${versionId}`);
  return diff;
}

export async function proposeVersion(
  db: Db,
  input: { sourceId: string; documentId: string; extraction: unknown; extractedBy: string },
): Promise<{ version: PolicyVersion; diff: PolicyDiff; created: boolean }> {
  return db.$transaction(async (tx) => {
    const source = await lockSource(tx, input.sourceId);
    const existing = await tx.policyVersion.findUnique({ where: { documentId: input.documentId } });
    if (existing) return { version: existing, diff: await diffForVersion(tx, existing.id), created: false };

    const market = markets[source.market];
    const parsed = market.extractSchema.safeParse(input.extraction);
    if (!parsed.success) {
      throw new AppError('extraction_invalid', 'The extraction does not match the market schema', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }

    const base = await latestApproved(tx, source.policyKey);
    const open = await tx.policyVersion.findFirst({ where: { policyKey: source.policyKey, status: 'proposed' } });
    if (open) {
      await tx.policyVersion.update({
        where: { id: open.id },
        data: { status: 'superseded', supersededAt: new Date() },
      });
    }
    const version = await tx.policyVersion.create({
      data: {
        sourceId: source.id,
        market: source.market,
        policyKey: source.policyKey,
        documentId: input.documentId,
        baseVersionId: base?.id ?? null,
        supersedesId: open?.id ?? null,
        extractSchema: market.schemaId,
        extractedJson: jsonInput(parsed.data),
        extractedBy: input.extractedBy,
      },
    });
    const changes = market.diff(base ? market.extractSchema.parse(base.extractedJson) : null, parsed.data);
    const diff = await tx.policyDiff.create({
      data: {
        policyKey: source.policyKey,
        fromVersionId: base?.id ?? null,
        toVersionId: version.id,
        diffJson: jsonInput(changes),
      },
    });
    return { version, diff, created: true };
  });
}

export async function approveVersion(db: Db, input: { versionId: string; approvedBy: string }): Promise<PolicyVersion> {
  return db.$transaction(async (tx) => {
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
    const updated = await tx.policyVersion.updateMany({
      where: { id: version.id, status: 'proposed' },
      data: {
        status: 'approved',
        version: (base?.version ?? 0) + 1,
        approvedAt: new Date(),
        approvedBy: input.approvedBy,
      },
    });
    if (updated.count !== 1) {
      throw new AppError('version_not_proposed', `Version ${version.id} is no longer proposed`, { status: version.status });
    }
    const approved = await tx.policyVersion.findUnique({ where: { id: version.id } });
    if (!approved) throw new AppError('internal', 'Expected the statement to return a row');
    return approved;
  });
}

export async function rejectVersion(
  db: Db,
  input: { versionId: string; rejectedBy: string; reason: string },
): Promise<PolicyVersion> {
  return db.$transaction(async (tx) => {
    const version = await lockVersion(tx, input.versionId);
    if (version.status === 'rejected') return version;
    if (version.status !== 'proposed') {
      throw new AppError('version_not_proposed', `Version ${version.id} is ${version.status} and cannot be rejected`, {
        status: version.status,
      });
    }
    const updated = await tx.policyVersion.updateMany({
      where: { id: version.id, status: 'proposed' },
      data: { status: 'rejected', rejectedAt: new Date(), rejectedBy: input.rejectedBy, rejectReason: input.reason },
    });
    if (updated.count !== 1) {
      throw new AppError('version_not_proposed', `Version ${version.id} is no longer proposed`, { status: version.status });
    }
    const rejected = await tx.policyVersion.findUnique({ where: { id: version.id } });
    if (!rejected) throw new AppError('internal', 'Expected the statement to return a row');
    return rejected;
  });
}

async function assertPolicyExists(db: Db, policyKey: string) {
  const source = await db.policySource.findUnique({ where: { policyKey }, select: { id: true } });
  if (!source) throw new AppError('not_found', `Policy ${policyKey} not found`);
}

export async function getPublishedPolicy(db: Db, policyKey: string): Promise<PolicyVersion> {
  const latest = await latestApproved(db, policyKey);
  if (latest) return latest;
  await assertPolicyExists(db, policyKey);
  throw new AppError('policy_not_published', `Policy ${policyKey} has no approved version yet`);
}

export async function getPublishedVersion(db: Db, policyKey: string, version: number): Promise<PolicyVersion> {
  const row = await db.policyVersion.findFirst({ where: { policyKey, status: 'approved', version } });
  if (!row) throw new AppError('not_found', `Policy ${policyKey} has no approved version ${version}`);
  return row;
}

export async function listPublishedVersions(db: Db, policyKey: string, page: PageRequest): Promise<Page<PolicyVersion>> {
  await assertPolicyExists(db, policyKey);
  const before = page.cursor ? decodeCursor(page.cursor, numberCursor)[0] : undefined;
  const rows = await db.policyVersion.findMany({
    where: {
      policyKey,
      status: 'approved',
      version: before === undefined ? undefined : { lt: before },
    },
    orderBy: { version: 'desc' },
    take: page.limit + 1,
  });
  return toPage(rows, page.limit, (row) => [row.version ?? 0]);
}

export async function getVersion(db: Db, id: string): Promise<PolicyVersion> {
  const row = await db.policyVersion.findUnique({ where: { id } });
  if (!row) throw new AppError('not_found', `Version ${id} not found`);
  return row;
}

export async function listVersions(
  db: Db,
  filter: { status?: VersionStatus | undefined; policyKey?: string | undefined },
  page: PageRequest,
): Promise<Page<PolicyVersion>> {
  const before = page.cursor ? decodeCursor(page.cursor, timeCursor) : undefined;
  const where: Prisma.PolicyVersionWhereInput = {
    status: filter.status,
    policyKey: filter.policyKey,
  };
  if (before) {
    const createdAt = new Date(before[0]);
    where.OR = [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: before[1] } }];
  }
  const rows = await db.policyVersion.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: page.limit + 1,
  });
  return toPage(rows, page.limit, (row) => [row.createdAt.toISOString(), row.id]);
}

export async function saveDiffNotes(
  db: Db,
  diffId: string,
  notes: { summary: string | null; review: unknown },
): Promise<PolicyDiff> {
  return db.policyDiff.update({
    where: { id: diffId },
    data: { summary: notes.summary, review: jsonInput(notes.review) },
  });
}

export async function getDiff(db: Db, id: string): Promise<PolicyDiff> {
  const diff = await db.policyDiff.findUnique({ where: { id } });
  if (!diff) throw new AppError('not_found', `Diff ${id} not found`);
  return diff;
}

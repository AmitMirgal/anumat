import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, notExists, sql } from 'drizzle-orm';
import { getPayer, getSource, type PolicySource } from '../catalog';
import type { AppContext } from '../context';
import { pdfToMarkdown } from '../convert/pdf-to-markdown';
import { one } from '../db/client';
import { policyArtifacts, policyDocuments, policySources, policyVersions, watchRuns } from '../db/schema';
import { toAppError } from '../errors';
import { log } from '../log';
import type { Change } from '../markets/registry';
import type { FetchedArtifact } from '../sources/adapters';
import { diffForVersion, type PolicyDiff, type PolicyVersion, proposeVersion, saveDiffNotes } from '../versions';

type Artifact = typeof policyArtifacts.$inferSelect;
type PolicyDocument = typeof policyDocuments.$inferSelect;
export type WatchRun = typeof watchRuns.$inferSelect;
export type CheckResult = { run: WatchRun; version: PolicyVersion | null; diff: PolicyDiff | null };

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function recordArtifact(ctx: AppContext, source: PolicySource, fetched: FetchedArtifact) {
  const sha = sha256(fetched.bytes);
  const storagePath = await ctx.blobs.put(`pdf/${sha}.pdf`, fetched.bytes);
  return ctx.db.transaction(async (tx) => {
    await tx.select({ id: policySources.id }).from(policySources).where(eq(policySources.id, source.id)).for('update');
    const [latest] = await tx
      .select()
      .from(policyArtifacts)
      .where(eq(policyArtifacts.sourceId, source.id))
      .orderBy(desc(policyArtifacts.fetchedAt))
      .limit(1);
    if (latest?.contentSha256 === sha) return { artifact: latest, created: false };
    const artifact = one(
      await tx
        .insert(policyArtifacts)
        .values({ sourceId: source.id, contentSha256: sha, storagePath, mime: fetched.mime, byteSize: fetched.bytes.byteLength })
        .returning(),
    );
    return { artifact, created: true };
  });
}

async function ensureDocument(ctx: AppContext, artifact: Artifact): Promise<PolicyDocument> {
  const [existing] = await ctx.db.select().from(policyDocuments).where(eq(policyDocuments.artifactId, artifact.id));
  if (existing?.status === 'converted') return existing;
  const upsert = (values: Omit<typeof policyDocuments.$inferInsert, 'artifactId'>) =>
    ctx.db
      .insert(policyDocuments)
      .values({ artifactId: artifact.id, ...values })
      .onConflictDoUpdate({ target: policyDocuments.artifactId, set: values })
      .returning();
  try {
    const { markdown, converter } = await pdfToMarkdown(await ctx.blobs.get(artifact.storagePath), {
      apiKey: ctx.config.firecrawlApiKey,
      apiUrl: ctx.config.firecrawlApiUrl,
    });
    const markdownPath = await ctx.blobs.put(`markdown/${artifact.contentSha256}.md`, new TextEncoder().encode(markdown));
    return one(await upsert({ status: 'converted', converter, markdownPath, errorCode: null, errorMessage: null }));
  } catch (error) {
    const failure = toAppError(error);
    await upsert({ status: 'failed', converter: null, markdownPath: null, errorCode: failure.code, errorMessage: failure.message });
    throw failure;
  }
}

async function ensureVersion(ctx: AppContext, source: PolicySource, document: PolicyDocument) {
  const [existing] = await ctx.db.select().from(policyVersions).where(eq(policyVersions.documentId, document.id));
  if (existing) return { version: existing, diff: await diffForVersion(ctx.db, existing.id) };

  const payer = await getPayer(ctx.db, source.payerId);
  const agent = ctx.agents[source.market];
  const extracted = await agent.extractDocument({
    documentId: document.id,
    policyKey: source.policyKey,
    payer: payer.name,
    title: source.title,
  });
  log.info(
    { documentId: document.id, model: extracted.model, charsRead: extracted.charsRead, sectionsRead: extracted.sectionsRead },
    'extraction captured',
  );
  const { version, diff, created } = await proposeVersion(ctx.db, {
    sourceId: source.id,
    documentId: document.id,
    extraction: extracted.extraction,
    extractedBy: extracted.model,
  });
  if (!created || agent.models.kind !== 'router') return { version, diff };

  const notes = await agent.annotateDiff({
    diffId: diff.id,
    documentId: document.id,
    policyKey: source.policyKey,
    changes: diff.diffJson as Change[],
  });
  if (notes.failures.length > 0) log.warn({ diffId: diff.id, failures: notes.failures }, 'diff notes incomplete');
  return { version, diff: await saveDiffNotes(ctx.db, diff.id, notes) };
}

export async function checkSource(ctx: AppContext, sourceId: string): Promise<CheckResult> {
  const source = await getSource(ctx.db, sourceId);
  const startedAt = new Date();
  let outcome: 'unchanged' | 'new_artifact' = 'unchanged';
  let artifact: Artifact | undefined;
  const finish = async (fields: { version?: PolicyVersion; diff?: PolicyDiff; error?: unknown }): Promise<CheckResult> => {
    const failure = fields.error === undefined ? undefined : toAppError(fields.error);
    const run = one(
      await ctx.db
        .insert(watchRuns)
        .values({
          sourceId: source.id,
          startedAt,
          finishedAt: new Date(),
          outcome: failure ? 'error' : outcome,
          artifactId: artifact?.id ?? null,
          versionId: fields.version?.id ?? null,
          errorCode: failure?.code ?? null,
          errorMessage: failure?.message ?? null,
        })
        .returning(),
    );
    log.info({ sourceId: source.id, runId: run.id, outcome: run.outcome, versionId: run.versionId, error: run.errorCode }, 'watch run');
    return { run, version: fields.version ?? null, diff: fields.diff ?? null };
  };

  try {
    const fetched = await ctx.adapters[source.adapterType].fetchArtifact(source);
    const recorded = await recordArtifact(ctx, source, fetched);
    artifact = recorded.artifact;
    outcome = recorded.created ? 'new_artifact' : 'unchanged';
    const document = await ensureDocument(ctx, artifact);
    return finish(await ensureVersion(ctx, source, document));
  } catch (error) {
    return finish({ error });
  }
}

export async function dueSources(ctx: AppContext): Promise<PolicySource[]> {
  const recentRun = ctx.db
    .select({ id: watchRuns.id })
    .from(watchRuns)
    .where(
      and(
        eq(watchRuns.sourceId, policySources.id),
        gt(watchRuns.startedAt, sql`now() - make_interval(hours => ${policySources.checkIntervalHours})`),
      ),
    );
  return ctx.db
    .select()
    .from(policySources)
    .where(and(eq(policySources.enabled, true), notExists(recentRun)))
    .orderBy(asc(policySources.policyKey));
}

export async function checkDueSources(ctx: AppContext): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const source of await dueSources(ctx)) results.push(await checkSource(ctx, source.id));
  return results;
}

import { createHash } from 'node:crypto';
import { getPayer, getSource, type PolicySource } from '../catalog';
import type { Converter } from '../convert/pdf-to-markdown';
import { pdfToMarkdown } from '../convert/pdf-to-markdown';
import type { AppContext } from '../context';
import { toAppError } from '@anumat/core';
import type { Converter as StoredConverter, PolicyArtifact, PolicyDocument, WatchRun } from '@anumat/db';
import { log } from '../log';
import type { Change } from '@anumat/markets';
import type { FetchedArtifact } from '../sources/adapters';
import { diffForVersion, type PolicyDiff, type PolicyVersion, proposeVersion, saveDiffNotes } from '../versions';

export type { WatchRun };
export type CheckResult = { run: WatchRun; version: PolicyVersion | null; diff: PolicyDiff | null };

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function storedConverter(converter: Converter): StoredConverter {
  switch (converter) {
    case 'anydoc':
      return 'anydoc';
    case 'firecrawl-parse':
      return 'firecrawl_parse';
    default: {
      const unreachable: never = converter;
      return unreachable;
    }
  }
}

async function recordArtifact(ctx: AppContext, source: PolicySource, fetched: FetchedArtifact) {
  const sha = sha256(fetched.bytes);
  const storagePath = await ctx.blobs.put(`pdf/${sha}.pdf`, fetched.bytes);
  return ctx.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM policy_sources WHERE id = CAST(${source.id} AS uuid) FOR UPDATE`;
    const latest = await tx.policyArtifact.findFirst({
      where: { sourceId: source.id },
      orderBy: { fetchedAt: 'desc' },
    });
    if (latest?.contentSha256 === sha) return { artifact: latest, created: false };
    const artifact = await tx.policyArtifact.create({
      data: {
        sourceId: source.id,
        contentSha256: sha,
        storagePath,
        mime: fetched.mime,
        byteSize: fetched.bytes.byteLength,
      },
    });
    return { artifact, created: true };
  });
}

async function ensureDocument(ctx: AppContext, artifact: PolicyArtifact): Promise<PolicyDocument> {
  const existing = await ctx.db.policyDocument.findUnique({ where: { artifactId: artifact.id } });
  if (existing?.status === 'converted') return existing;
  const upsert = (values: {
    status: 'converted' | 'failed';
    converter: StoredConverter | null;
    markdownPath: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  }) =>
    ctx.db.policyDocument.upsert({
      where: { artifactId: artifact.id },
      create: { artifactId: artifact.id, ...values },
      update: values,
    });
  try {
    const { markdown, converter } = await pdfToMarkdown(await ctx.blobs.get(artifact.storagePath), {
      apiKey: ctx.config.firecrawlApiKey,
      apiUrl: ctx.config.firecrawlApiUrl,
    });
    const markdownPath = await ctx.blobs.put(`markdown/${artifact.contentSha256}.md`, new TextEncoder().encode(markdown));
    return upsert({
      status: 'converted',
      converter: storedConverter(converter),
      markdownPath,
      errorCode: null,
      errorMessage: null,
    });
  } catch (error) {
    const failure = toAppError(error);
    await upsert({
      status: 'failed',
      converter: null,
      markdownPath: null,
      errorCode: failure.code,
      errorMessage: failure.message,
    });
    throw failure;
  }
}

async function ensureVersion(ctx: AppContext, source: PolicySource, document: PolicyDocument) {
  const existing = await ctx.db.policyVersion.findUnique({ where: { documentId: document.id } });
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
  const { version, diff, created } = await proposeVersion(
    ctx.db,
    {
      sourceId: source.id,
      documentId: document.id,
      extraction: extracted.extraction,
      extractedBy: extracted.model,
    },
    ctx.plugins,
  );
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
  let artifact: PolicyArtifact | undefined;
  const finish = async (fields: { version?: PolicyVersion; diff?: PolicyDiff; error?: unknown }): Promise<CheckResult> => {
    const failure = fields.error === undefined ? undefined : toAppError(fields.error);
    const run = await ctx.db.watchRun.create({
      data: {
        sourceId: source.id,
        startedAt,
        finishedAt: new Date(),
        outcome: failure ? 'error' : outcome,
        artifactId: artifact?.id ?? null,
        versionId: fields.version?.id ?? null,
        errorCode: failure?.code ?? null,
        errorMessage: failure?.message ?? null,
      },
    });
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
  const due = await ctx.db.$queryRaw<Array<{ id: string }>>`
    SELECT s.id
    FROM policy_sources s
    WHERE s.enabled = true
      AND NOT EXISTS (
        SELECT 1
        FROM watch_runs r
        WHERE r.source_id = s.id
          AND r.started_at > now() - make_interval(hours => s.check_interval_hours)
      )
    ORDER BY s.policy_key ASC
  `;
  if (due.length === 0) return [];
  return ctx.db.policySource.findMany({
    where: { id: { in: due.map((row) => row.id) } },
    orderBy: { policyKey: 'asc' },
  });
}

export async function checkDueSources(ctx: AppContext): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const due = await dueSources(ctx);
  const seen = new Set(due.map((source) => source.id));
  for (const source of due) results.push(await checkSource(ctx, source.id));
  for (const feed of ctx.plugins.ruleFeeds) {
    for (const update of await feed.listUpdates()) {
      if (seen.has(update.sourceId)) continue;
      seen.add(update.sourceId);
      results.push(await checkSource(ctx, update.sourceId));
    }
  }
  return results;
}

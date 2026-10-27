import type { Page } from '@anumat/core';
import type { PolicyDiff, PolicySource, PolicyVersion, WatchRun } from '@anumat/engine';
import type { Payer } from '@anumat/engine';

function iso(value: Date): string;
function iso(value: Date | null): string | null;
function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export const payerDto = (payer: Payer) => ({
  id: payer.id,
  name: payer.name,
  slug: payer.slug,
  market: payer.market,
  created_at: iso(payer.createdAt),
  updated_at: iso(payer.updatedAt),
});

export const sourceDto = (source: PolicySource) => ({
  id: source.id,
  payer_id: source.payerId,
  market: source.market,
  policy_key: source.policyKey,
  title: source.title,
  source_url: source.sourceUrl,
  adapter_type: source.adapterType,
  check_interval_hours: source.checkIntervalHours,
  enabled: source.enabled,
  created_at: iso(source.createdAt),
  updated_at: iso(source.updatedAt),
});

export const versionDto = (version: PolicyVersion) => ({
  id: version.id,
  policy_key: version.policyKey,
  market: version.market,
  status: version.status,
  version: version.version,
  source_id: version.sourceId,
  document_id: version.documentId,
  base_version_id: version.baseVersionId,
  supersedes_id: version.supersedesId,
  extract_schema: version.extractSchema,
  extracted_by: version.extractedBy,
  created_at: iso(version.createdAt),
  approved_at: iso(version.approvedAt),
  approved_by: version.approvedBy,
  rejected_at: iso(version.rejectedAt),
  rejected_by: version.rejectedBy,
  reject_reason: version.rejectReason,
  superseded_at: iso(version.supersededAt),
  rules: version.extractedJson,
});

export const publishedDto = (version: PolicyVersion, source: PolicySource) => {
  if (version.version === null) throw new Error(`Approved version ${version.id} is missing a version number`);
  return {
    policy_key: version.policyKey,
    market: version.market,
    version: version.version,
    version_id: version.id,
    approved_at: iso(version.approvedAt),
    approved_by: version.approvedBy,
    extract_schema: version.extractSchema,
    source: { title: source.title, url: source.sourceUrl },
    rules: version.extractedJson,
  };
};

export const diffDto = (diff: PolicyDiff) => ({
  id: diff.id,
  policy_key: diff.policyKey,
  from_version_id: diff.fromVersionId,
  to_version_id: diff.toVersionId,
  changes: diff.diffJson,
  summary: diff.summary,
  review: diff.review,
  created_at: iso(diff.createdAt),
});

export const watchRunDto = (run: WatchRun) => ({
  id: run.id,
  source_id: run.sourceId,
  started_at: iso(run.startedAt),
  finished_at: iso(run.finishedAt),
  outcome: run.outcome,
  artifact_id: run.artifactId,
  version_id: run.versionId,
  error: run.errorCode ? { code: run.errorCode, message: run.errorMessage } : null,
});

export const pageDto = <T, D>(page: Page<T>, dto: (item: T) => D) => ({
  items: page.items.map(dto),
  next_cursor: page.nextCursor,
});

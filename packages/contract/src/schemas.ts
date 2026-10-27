import { MARKET_IDS } from '@anumat/core';
import { z } from 'zod';

export const marketSchema = z.enum(MARKET_IDS);

export const VERSION_STATUSES = ['proposed', 'approved', 'rejected', 'superseded'] as const;
export const versionStatusSchema = z.enum(VERSION_STATUSES);

export const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits, and single hyphens');
export const id = z.uuid();

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const NewPayer = z.strictObject({
  name: z.string().min(2).max(120),
  slug,
  market: marketSchema,
});

export const NewSource = z.strictObject({
  payer_id: id,
  title: z.string().min(2).max(300),
  source_url: z.url({ protocol: /^https?$/ }),
  policy_slug: slug.optional(),
  market: marketSchema.optional(),
  adapter_type: z.literal('http_pdf').optional(),
  check_interval_hours: z.number().int().min(1).max(720).optional(),
  enabled: z.boolean().optional(),
});

export const Rejection = z.strictObject({ reason: z.string().min(3).max(1000) });

export const VersionFilter = pageQuery.extend({
  status: versionStatusSchema.optional(),
  policy_key: z.string().optional(),
});

export const SourceId = z.object({ id });
export const PolicyKey = z.object({ policyKey: z.string() });
export const PolicyVersionsQuery = pageQuery.extend({ policyKey: z.string() });
export const PolicyVersionQuery = z.object({
  policyKey: z.string(),
  version: z.coerce.number().int().positive(),
});
export const RejectVersion = z.object({ id, reason: z.string().min(3).max(1000) });

const timestamp = z.string();
const nullableTimestamp = z.string().nullable();

export const Payer = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  market: marketSchema,
  created_at: timestamp,
  updated_at: timestamp,
});

export const Source = z.object({
  id,
  payer_id: id,
  market: marketSchema,
  policy_key: z.string(),
  title: z.string(),
  source_url: z.string(),
  adapter_type: z.string(),
  check_interval_hours: z.number().int(),
  enabled: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const Version = z.object({
  id,
  policy_key: z.string(),
  market: marketSchema,
  status: versionStatusSchema,
  version: z.number().int().nullable(),
  source_id: id,
  document_id: id,
  base_version_id: id.nullable(),
  supersedes_id: id.nullable(),
  extract_schema: z.string(),
  extracted_by: z.string(),
  created_at: timestamp,
  approved_at: nullableTimestamp,
  approved_by: z.string().nullable(),
  rejected_at: nullableTimestamp,
  rejected_by: z.string().nullable(),
  reject_reason: z.string().nullable(),
  superseded_at: nullableTimestamp,
  rules: z.unknown(),
});

export const VersionDetail = Version.extend({ diff_id: id });

export const PublishedPolicy = z.object({
  policy_key: z.string(),
  market: marketSchema,
  version: z.number().int(),
  version_id: id,
  approved_at: nullableTimestamp,
  approved_by: z.string().nullable(),
  extract_schema: z.string(),
  source: z.object({ title: z.string(), url: z.string() }),
  rules: z.unknown(),
});

export const Diff = z.object({
  id,
  policy_key: z.string(),
  from_version_id: id.nullable(),
  to_version_id: id,
  changes: z.unknown(),
  summary: z.string().nullable(),
  review: z.unknown().nullable(),
  created_at: timestamp,
});

export const WatchRun = z.object({
  id,
  source_id: id,
  started_at: timestamp,
  finished_at: nullableTimestamp,
  outcome: z.string(),
  artifact_id: id.nullable(),
  version_id: id.nullable(),
  error: z.object({ code: z.string(), message: z.string().nullable() }).nullable(),
});

export const CheckResult = z.object({
  watch_run: WatchRun,
  version: Version.nullable(),
  diff: Diff.nullable(),
});

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });

export type PageQuery = z.infer<typeof pageQuery>;
export type NewPayerInput = z.infer<typeof NewPayer>;
export type NewSourceInput = z.infer<typeof NewSource>;
export type VersionFilterInput = z.infer<typeof VersionFilter>;

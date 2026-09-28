import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const market = pgEnum('market', ['us']);
export const adapterType = pgEnum('adapter_type', ['http_pdf']);
export const converter = pgEnum('converter', ['anydoc', 'firecrawl-parse']);
export const documentStatus = pgEnum('document_status', ['converted', 'failed']);
export const versionStatus = pgEnum('version_status', ['proposed', 'approved', 'rejected', 'superseded']);
export const watchOutcome = pgEnum('watch_outcome', ['unchanged', 'new_artifact', 'error']);

const createdAt = () => timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const payers = pgTable(
  'payers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    market: market('market').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('payers_id_market_key').on(t.id, t.market),
    check('payers_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const policySources = pgTable(
  'policy_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payerId: uuid('payer_id').notNull(),
    market: market('market').notNull(),
    policyKey: text('policy_key').notNull().unique(),
    title: text('title').notNull(),
    sourceUrl: text('source_url').notNull().unique(),
    adapterType: adapterType('adapter_type').notNull().default('http_pdf'),
    checkIntervalHours: integer('check_interval_hours').notNull().default(24),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ columns: [t.payerId, t.market], foreignColumns: [payers.id, payers.market] }),
    unique('policy_sources_id_market_policy_key_key').on(t.id, t.market, t.policyKey),
    check('policy_sources_check_interval', sql`${t.checkIntervalHours} between 1 and 720`),
    check(
      'policy_sources_policy_key_format',
      sql`${t.policyKey} ~ '^[a-z0-9]+(-[a-z0-9]+)*[.][a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
  ],
);

export const policyArtifacts = pgTable(
  'policy_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => policySources.id),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    contentSha256: text('content_sha256').notNull(),
    storagePath: text('storage_path').notNull(),
    mime: text('mime').notNull(),
    byteSize: integer('byte_size').notNull(),
  },
  (t) => [
    index('policy_artifacts_source_fetched_idx').on(t.sourceId, t.fetchedAt.desc()),
    check('policy_artifacts_sha256_hex', sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const policyDocuments = pgTable(
  'policy_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artifactId: uuid('artifact_id')
      .notNull()
      .unique()
      .references(() => policyArtifacts.id),
    status: documentStatus('status').notNull(),
    converter: converter('converter'),
    markdownPath: text('markdown_path'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'policy_documents_converted_fields',
      sql`(${t.status} = 'converted') = (${t.converter} is not null and ${t.markdownPath} is not null)`,
    ),
    check('policy_documents_failed_fields', sql`(${t.status} = 'failed') = (${t.errorCode} is not null)`),
  ],
);

export const policyVersions = pgTable(
  'policy_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').notNull(),
    market: market('market').notNull(),
    policyKey: text('policy_key').notNull(),
    documentId: uuid('document_id')
      .notNull()
      .unique()
      .references(() => policyDocuments.id),
    baseVersionId: uuid('base_version_id').references((): AnyPgColumn => policyVersions.id),
    supersedesId: uuid('supersedes_id').references((): AnyPgColumn => policyVersions.id),
    status: versionStatus('status').notNull().default('proposed'),
    version: integer('version'),
    extractSchema: text('extract_schema').notNull(),
    extractedJson: jsonb('extracted_json').notNull(),
    extractedBy: text('extracted_by').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: text('approved_by'),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectedBy: text('rejected_by'),
    rejectReason: text('reject_reason'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.sourceId, t.market, t.policyKey],
      foreignColumns: [policySources.id, policySources.market, policySources.policyKey],
    }),
    unique('policy_versions_policy_key_version_key').on(t.policyKey, t.version),
    uniqueIndex('policy_versions_one_open_proposal').on(t.policyKey).where(sql`${t.status} = 'proposed'`),
    index('policy_versions_status_created_idx').on(t.status, t.createdAt),
    check(
      'policy_versions_approved_fields',
      sql`num_nulls(${t.version}, ${t.approvedAt}, ${t.approvedBy}) = case when ${t.status} = 'approved' then 0 else 3 end`,
    ),
    check(
      'policy_versions_rejected_fields',
      sql`num_nulls(${t.rejectedAt}, ${t.rejectedBy}) = case when ${t.status} = 'rejected' then 0 else 2 end`,
    ),
    check('policy_versions_superseded_fields', sql`(${t.supersededAt} is not null) = (${t.status} = 'superseded')`),
    check('policy_versions_version_positive', sql`${t.version} > 0`),
  ],
);

export const policyDiffs = pgTable('policy_diffs', {
  id: uuid('id').primaryKey().defaultRandom(),
  policyKey: text('policy_key').notNull(),
  fromVersionId: uuid('from_version_id').references(() => policyVersions.id),
  toVersionId: uuid('to_version_id')
    .notNull()
    .unique()
    .references(() => policyVersions.id),
  diffJson: jsonb('diff_json').notNull(),
  summary: text('summary'),
  review: jsonb('review'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const watchRuns = pgTable(
  'watch_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => policySources.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
    outcome: watchOutcome('outcome').notNull(),
    artifactId: uuid('artifact_id').references(() => policyArtifacts.id),
    versionId: uuid('version_id').references(() => policyVersions.id),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
  },
  (t) => [
    index('watch_runs_source_started_idx').on(t.sourceId, t.startedAt.desc()),
    check('watch_runs_error_fields', sql`(${t.outcome} = 'error') = (${t.errorCode} is not null)`),
  ],
);

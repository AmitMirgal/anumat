import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { getSource, listPayers, listSources, type Payer, type PolicySource, registerPayer, registerSource } from '../catalog';
import type { AppContext } from '../context';
import { market, versionStatus } from '../db/schema';
import { AppError } from '../errors';
import type { Page } from '../pagination';
import { checkSource, type WatchRun } from '../pipeline/check';
import {
  approveVersion,
  diffForVersion,
  getDiff,
  getPublishedPolicy,
  getPublishedVersion,
  getVersion,
  listPublishedVersions,
  listVersions,
  type PolicyDiff,
  type PolicyVersion,
  rejectVersion,
} from '../versions';
import type { AppEnv } from './app';

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits, and single hyphens');
const id = z.uuid();
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

const NewPayer = z.strictObject({ name: z.string().min(2).max(120), slug, market: z.enum(market.enumValues) });
const NewSource = z.strictObject({
  payer_id: id,
  title: z.string().min(2).max(300),
  source_url: z.url({ protocol: /^https?$/ }),
  policy_slug: slug.optional(),
  market: z.enum(market.enumValues).optional(),
  adapter_type: z.literal('http_pdf').optional(),
  check_interval_hours: z.number().int().min(1).max(720).optional(),
  enabled: z.boolean().optional(),
});
const Rejection = z.strictObject({ reason: z.string().min(3).max(1000) });
const VersionFilter = pageQuery.extend({
  status: z.enum(versionStatus.enumValues).optional(),
  policy_key: z.string().optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('validation_failed', 'Request validation failed', {
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return result.data;
}

async function jsonBody<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = await c.req.json().catch(() => {
    throw new AppError('validation_failed', 'Request body must be a JSON object');
  });
  return parse(schema, raw);
}

const payerDto = (p: Payer) => ({
  id: p.id,
  name: p.name,
  slug: p.slug,
  market: p.market,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
});

const sourceDto = (s: PolicySource) => ({
  id: s.id,
  payer_id: s.payerId,
  market: s.market,
  policy_key: s.policyKey,
  title: s.title,
  source_url: s.sourceUrl,
  adapter_type: s.adapterType,
  check_interval_hours: s.checkIntervalHours,
  enabled: s.enabled,
  created_at: s.createdAt,
  updated_at: s.updatedAt,
});

const versionDto = (v: PolicyVersion) => ({
  id: v.id,
  policy_key: v.policyKey,
  market: v.market,
  status: v.status,
  version: v.version,
  source_id: v.sourceId,
  document_id: v.documentId,
  base_version_id: v.baseVersionId,
  supersedes_id: v.supersedesId,
  extract_schema: v.extractSchema,
  extracted_by: v.extractedBy,
  created_at: v.createdAt,
  approved_at: v.approvedAt,
  approved_by: v.approvedBy,
  rejected_at: v.rejectedAt,
  rejected_by: v.rejectedBy,
  reject_reason: v.rejectReason,
  superseded_at: v.supersededAt,
  rules: v.extractedJson,
});

const publishedDto = (v: PolicyVersion, source: PolicySource) => ({
  policy_key: v.policyKey,
  market: v.market,
  version: v.version,
  version_id: v.id,
  approved_at: v.approvedAt,
  approved_by: v.approvedBy,
  extract_schema: v.extractSchema,
  source: { title: source.title, url: source.sourceUrl },
  rules: v.extractedJson,
});

const diffDto = (d: PolicyDiff) => ({
  id: d.id,
  policy_key: d.policyKey,
  from_version_id: d.fromVersionId,
  to_version_id: d.toVersionId,
  changes: d.diffJson,
  summary: d.summary,
  review: d.review,
  created_at: d.createdAt,
});

const watchRunDto = (r: WatchRun) => ({
  id: r.id,
  source_id: r.sourceId,
  started_at: r.startedAt,
  finished_at: r.finishedAt,
  outcome: r.outcome,
  artifact_id: r.artifactId,
  version_id: r.versionId,
  error: r.errorCode ? { code: r.errorCode, message: r.errorMessage } : null,
});

const pageDto = <T, D>(page: Page<T>, dto: (item: T) => D) => ({ items: page.items.map(dto), next_cursor: page.nextCursor });

export function v1(ctx: AppContext) {
  const { db } = ctx;
  const routes = new Hono<AppEnv>();

  routes.post('/payers', async (c) => c.json(payerDto(await registerPayer(db, await jsonBody(c, NewPayer))), 201));
  routes.get('/payers', async (c) => c.json(pageDto(await listPayers(db, parse(pageQuery, c.req.query())), payerDto)));

  routes.post('/sources', async (c) => {
    const input = await jsonBody(c, NewSource);
    const source = await registerSource(db, {
      payerId: input.payer_id,
      title: input.title,
      sourceUrl: input.source_url,
      policySlug: input.policy_slug,
      market: input.market,
      checkIntervalHours: input.check_interval_hours,
      enabled: input.enabled,
    });
    return c.json(sourceDto(source), 201);
  });
  routes.get('/sources', async (c) => c.json(pageDto(await listSources(db, parse(pageQuery, c.req.query())), sourceDto)));
  routes.get('/sources/:id', async (c) => c.json(sourceDto(await getSource(db, parse(id, c.req.param('id'))))));
  routes.post('/sources/:id/check', async (c) => {
    const result = await checkSource(ctx, parse(id, c.req.param('id')));
    return c.json({
      watch_run: watchRunDto(result.run),
      version: result.version && versionDto(result.version),
      diff: result.diff && diffDto(result.diff),
    });
  });

  routes.get('/policies/:policyKey', async (c) => {
    const version = await getPublishedPolicy(db, c.req.param('policyKey'));
    return c.json(publishedDto(version, await getSource(db, version.sourceId)));
  });
  routes.get('/policies/:policyKey/versions', async (c) => {
    const page = await listPublishedVersions(db, c.req.param('policyKey'), parse(pageQuery, c.req.query()));
    return c.json(pageDto(page, versionDto));
  });
  routes.get('/policies/:policyKey/versions/:version', async (c) => {
    const number = parse(z.coerce.number().int().positive(), c.req.param('version'));
    const version = await getPublishedVersion(db, c.req.param('policyKey'), number);
    return c.json(publishedDto(version, await getSource(db, version.sourceId)));
  });

  routes.get('/versions', async (c) => {
    const query = parse(VersionFilter, c.req.query());
    const page = await listVersions(db, { status: query.status, policyKey: query.policy_key }, query);
    return c.json(pageDto(page, versionDto));
  });
  routes.get('/versions/:id', async (c) => {
    const version = await getVersion(db, parse(id, c.req.param('id')));
    return c.json({ ...versionDto(version), diff_id: (await diffForVersion(db, version.id)).id });
  });
  routes.post('/versions/:id/approve', async (c) => {
    const version = await approveVersion(db, { versionId: parse(id, c.req.param('id')), approvedBy: c.get('principal') });
    return c.json(versionDto(version));
  });
  routes.post('/versions/:id/reject', async (c) => {
    const { reason } = await jsonBody(c, Rejection);
    const version = await rejectVersion(db, { versionId: parse(id, c.req.param('id')), rejectedBy: c.get('principal'), reason });
    return c.json(versionDto(version));
  });

  routes.get('/diffs/:id', async (c) => c.json(diffDto(await getDiff(db, parse(id, c.req.param('id'))))));

  return routes;
}

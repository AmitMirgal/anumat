import { AppError, MARKET_IDS, type PageRequest } from '@anumat/core';
import type { VersionStatus } from '@anumat/db';
import { z } from 'zod';
import type { AppContext } from './context';
import {
  findPayerBySlug,
  findSourceByPolicyKey,
  getPayer,
  getSource,
  listPayers,
  listSources,
  registerPayer,
  registerSource,
} from './catalog';
import { checkDueSources, checkSource, dueSources } from './pipeline/check';
import {
  approveVersion,
  diffForVersion,
  getDiff,
  getPublishedPolicy,
  getPublishedVersion,
  getVersion,
  listPublishedVersions,
  listVersions,
  proposeVersion,
  rejectVersion,
  saveDiffNotes,
} from './versions';

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits, and single hyphens');
const market = z.enum(MARKET_IDS);
const versionStatus = z.enum(['proposed', 'approved', 'rejected', 'superseded']);

const pageInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

const idInput = z.object({ id: z.uuid() });

const emptyInput = z.object({}).strict();

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError('validation_failed', 'Request validation failed', {
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return result.data;
}

function pageOf(input: z.infer<typeof pageInput>): PageRequest {
  return { limit: input.limit, cursor: input.cursor };
}

const handlers = {
  register_payer: async (ctx: AppContext, input: unknown) => {
    const body = parse(z.object({ name: z.string().min(2).max(120), slug, market }).strict(), input);
    return registerPayer(ctx.db, body);
  },
  get_payer: async (ctx: AppContext, input: unknown) => getPayer(ctx.db, parse(idInput, input).id),
  find_payer_by_slug: async (ctx: AppContext, input: unknown) => findPayerBySlug(ctx.db, parse(z.object({ slug: z.string().min(1) }).strict(), input).slug),
  list_payers: async (ctx: AppContext, input: unknown) => listPayers(ctx.db, pageOf(parse(pageInput, input))),
  register_source: async (ctx: AppContext, input: unknown) => {
    const body = parse(
      z
        .object({
          payer_id: z.uuid(),
          title: z.string().min(2).max(300),
          source_url: z.url(),
          policy_slug: slug.optional(),
          market: market.optional(),
          check_interval_hours: z.number().int().min(1).max(720).optional(),
          enabled: z.boolean().optional(),
        })
        .strict(),
      input,
    );
    return registerSource(ctx.db, {
      payerId: body.payer_id,
      title: body.title,
      sourceUrl: body.source_url,
      policySlug: body.policy_slug,
      market: body.market,
      checkIntervalHours: body.check_interval_hours,
      enabled: body.enabled,
    });
  },
  get_source: async (ctx: AppContext, input: unknown) => getSource(ctx.db, parse(idInput, input).id),
  find_source_by_policy_key: async (ctx: AppContext, input: unknown) =>
    findSourceByPolicyKey(ctx.db, parse(z.object({ policy_key: z.string().min(1) }).strict(), input).policy_key),
  list_sources: async (ctx: AppContext, input: unknown) => listSources(ctx.db, pageOf(parse(pageInput, input))),
  check_source: async (ctx: AppContext, input: unknown) => checkSource(ctx, parse(z.object({ source_id: z.uuid() }).strict(), input).source_id),
  due_sources: async (ctx: AppContext, input: unknown) => {
    parse(emptyInput, input);
    return dueSources(ctx);
  },
  check_due_sources: async (ctx: AppContext, input: unknown) => {
    parse(emptyInput, input);
    return checkDueSources(ctx);
  },
  propose_version: async (ctx: AppContext, input: unknown) => {
    const body = parse(
      z
        .object({
          source_id: z.uuid(),
          document_id: z.uuid(),
          extraction: z.unknown(),
          extracted_by: z.string().min(1),
        })
        .strict(),
      input,
    );
    return proposeVersion(
      ctx.db,
      {
        sourceId: body.source_id,
        documentId: body.document_id,
        extraction: body.extraction,
        extractedBy: body.extracted_by,
      },
      ctx.plugins,
    );
  },
  approve_version: async (ctx: AppContext, input: unknown) => {
    const body = parse(z.object({ version_id: z.uuid(), approved_by: z.string().min(1) }).strict(), input);
    return approveVersion(ctx.db, { versionId: body.version_id, approvedBy: body.approved_by }, ctx.plugins);
  },
  reject_version: async (ctx: AppContext, input: unknown) => {
    const body = parse(
      z.object({ version_id: z.uuid(), rejected_by: z.string().min(1), reason: z.string().min(3).max(1000) }).strict(),
      input,
    );
    return rejectVersion(
      ctx.db,
      { versionId: body.version_id, rejectedBy: body.rejected_by, reason: body.reason },
      ctx.plugins,
    );
  },
  get_published_policy: async (ctx: AppContext, input: unknown) =>
    getPublishedPolicy(ctx.db, parse(z.object({ policy_key: z.string().min(1) }).strict(), input).policy_key),
  get_published_version: async (ctx: AppContext, input: unknown) => {
    const body = parse(z.object({ policy_key: z.string().min(1), version: z.number().int().positive() }).strict(), input);
    return getPublishedVersion(ctx.db, body.policy_key, body.version);
  },
  list_published_versions: async (ctx: AppContext, input: unknown) => {
    const body = parse(pageInput.extend({ policy_key: z.string().min(1) }), input);
    return listPublishedVersions(ctx.db, body.policy_key, pageOf(body));
  },
  get_version: async (ctx: AppContext, input: unknown) => getVersion(ctx.db, parse(idInput, input).id),
  list_versions: async (ctx: AppContext, input: unknown) => {
    const body = parse(pageInput.extend({ status: versionStatus.optional(), policy_key: z.string().min(1).optional() }), input);
    return listVersions(ctx.db, { status: body.status as VersionStatus | undefined, policyKey: body.policy_key }, pageOf(body));
  },
  get_diff: async (ctx: AppContext, input: unknown) => getDiff(ctx.db, parse(idInput, input).id),
  diff_for_version: async (ctx: AppContext, input: unknown) => diffForVersion(ctx.db, parse(z.object({ version_id: z.uuid() }).strict(), input).version_id),
  save_diff_notes: async (ctx: AppContext, input: unknown) => {
    const body = parse(
      z.object({ diff_id: z.uuid(), summary: z.string().nullable(), review: z.unknown() }).strict(),
      input,
    );
    return saveDiffNotes(ctx.db, body.diff_id, { summary: body.summary, review: body.review });
  },
} satisfies Record<string, (ctx: AppContext, input: unknown) => Promise<unknown>>;

export type EngineMethod = keyof typeof handlers;

export async function callEngineMethod(ctx: AppContext, method: string, input: unknown): Promise<unknown> {
  const handler = handlers[method as EngineMethod];
  if (handler === undefined || !Object.hasOwn(handlers, method)) {
    throw new AppError('not_found', `Unknown engine method ${method}`);
  }
  return handler(ctx, input ?? {});
}

export function toJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item)),
  ) as unknown;
}

import { AppError, MARKET_IDS, type PageRequest } from '@anumat/core';
import type { VersionStatus } from '@anumat/db';
import type { Market } from '@anumat/markets';
import * as z from 'zod';
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
import type { AppContext } from './context';
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

export const POLICY_METHODS = [
  ['registerPayer', 'register_payer'],
  ['getPayer', 'get_payer'],
  ['findPayerBySlug', 'find_payer_by_slug'],
  ['listPayers', 'list_payers'],
  ['registerSource', 'register_source'],
  ['getSource', 'get_source'],
  ['findSourceByPolicyKey', 'find_source_by_policy_key'],
  ['listSources', 'list_sources'],
  ['checkSource', 'check_source'],
  ['dueSources', 'due_sources'],
  ['checkDueSources', 'check_due_sources'],
  ['proposeVersion', 'propose_version'],
  ['approveVersion', 'approve_version'],
  ['rejectVersion', 'reject_version'],
  ['getPublishedPolicy', 'get_published_policy'],
  ['getPublishedVersion', 'get_published_version'],
  ['listPublishedVersions', 'list_published_versions'],
  ['getVersion', 'get_version'],
  ['listVersions', 'list_versions'],
  ['getDiff', 'get_diff'],
  ['diffForVersion', 'diff_for_version'],
  ['saveDiffNotes', 'save_diff_notes'],
] as const;

export type PolicyMethod = (typeof POLICY_METHODS)[number][0];
export type PythonPolicyMethod = (typeof POLICY_METHODS)[number][1];

const pythonToJs = new Map<string, PolicyMethod>(POLICY_METHODS.map(([javascript, python]) => [python, javascript]));

export function policyMethodFromPython(method: string): PolicyMethod | undefined {
  return pythonToJs.get(method);
}

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits, and single hyphens');
const market = z.enum(MARKET_IDS);
const versionStatus = z.enum(['proposed', 'approved', 'rejected', 'superseded']);
const page = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
const idInput = z.object({ id: z.uuid() }).strict();
const emptyInput = z.object({}).strict();

export const policyInputs = {
  registerPayer: z.object({ name: z.string().min(2).max(120), slug, market }).strict(),
  getPayer: idInput,
  findPayerBySlug: z.object({ slug: z.string().min(1) }).strict(),
  listPayers: page,
  registerSource: z
    .object({
      payerId: z.uuid(),
      title: z.string().min(2).max(300),
      sourceUrl: z.url(),
      policySlug: slug.optional(),
      market: market.optional(),
      checkIntervalHours: z.number().int().min(1).max(720).optional(),
      enabled: z.boolean().optional(),
    })
    .strict(),
  getSource: idInput,
  findSourceByPolicyKey: z.object({ policyKey: z.string().min(1) }).strict(),
  listSources: page,
  checkSource: z.object({ sourceId: z.uuid() }).strict(),
  dueSources: emptyInput,
  checkDueSources: emptyInput,
  proposeVersion: z
    .object({
      sourceId: z.uuid(),
      documentId: z.uuid(),
      extraction: z.unknown(),
      extractedBy: z.string().min(1),
    })
    .strict(),
  approveVersion: z.object({ versionId: z.uuid(), approvedBy: z.string().min(1) }).strict(),
  rejectVersion: z
    .object({
      versionId: z.uuid(),
      rejectedBy: z.string().min(1),
      reason: z.string().min(3).max(1000),
    })
    .strict(),
  getPublishedPolicy: z.object({ policyKey: z.string().min(1) }).strict(),
  getPublishedVersion: z.object({ policyKey: z.string().min(1), version: z.number().int().positive() }).strict(),
  listPublishedVersions: page.extend({ policyKey: z.string().min(1) }),
  getVersion: idInput,
  listVersions: page.extend({ status: versionStatus.optional(), policyKey: z.string().min(1).optional() }),
  getDiff: idInput,
  diffForVersion: z.object({ versionId: z.uuid() }).strict(),
  saveDiffNotes: z.object({ diffId: z.uuid(), summary: z.string().nullable(), review: z.unknown() }).strict(),
} satisfies Record<PolicyMethod, z.ZodType>;

const SNAKE_TO_CAMEL: Record<string, string> = {
  payer_id: 'payerId',
  source_url: 'sourceUrl',
  policy_slug: 'policySlug',
  check_interval_hours: 'checkIntervalHours',
  source_id: 'sourceId',
  document_id: 'documentId',
  extracted_by: 'extractedBy',
  version_id: 'versionId',
  approved_by: 'approvedBy',
  rejected_by: 'rejectedBy',
  policy_key: 'policyKey',
  diff_id: 'diffId',
};

export function camelPolicyInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const name = SNAKE_TO_CAMEL[key] ?? key;
    out[name] = value;
  }
  return out;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError('validation_failed', 'Request validation failed', {
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return result.data;
}

function pageOf(input: { limit: number; cursor?: string | undefined }): PageRequest {
  return { limit: input.limit, cursor: input.cursor };
}

export function toJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item)),
  ) as unknown;
}

export async function callPolicy(ctx: AppContext, method: PolicyMethod, input: unknown): Promise<unknown> {
  switch (method) {
    case 'registerPayer': {
      const body = parse(policyInputs.registerPayer, input);
      return registerPayer(ctx.db, { name: body.name, slug: body.slug, market: body.market as Market });
    }
    case 'getPayer':
      return getPayer(ctx.db, parse(policyInputs.getPayer, input).id);
    case 'findPayerBySlug':
      return findPayerBySlug(ctx.db, parse(policyInputs.findPayerBySlug, input).slug);
    case 'listPayers':
      return listPayers(ctx.db, pageOf(parse(policyInputs.listPayers, input)));
    case 'registerSource': {
      const body = parse(policyInputs.registerSource, input);
      return registerSource(ctx.db, {
        payerId: body.payerId,
        title: body.title,
        sourceUrl: body.sourceUrl,
        policySlug: body.policySlug,
        market: body.market as Market | undefined,
        checkIntervalHours: body.checkIntervalHours,
        enabled: body.enabled,
      });
    }
    case 'getSource':
      return getSource(ctx.db, parse(policyInputs.getSource, input).id);
    case 'findSourceByPolicyKey':
      return findSourceByPolicyKey(ctx.db, parse(policyInputs.findSourceByPolicyKey, input).policyKey);
    case 'listSources':
      return listSources(ctx.db, pageOf(parse(policyInputs.listSources, input)));
    case 'checkSource':
      return checkSource(ctx, parse(policyInputs.checkSource, input).sourceId);
    case 'dueSources':
      parse(policyInputs.dueSources, input);
      return dueSources(ctx);
    case 'checkDueSources':
      parse(policyInputs.checkDueSources, input);
      return checkDueSources(ctx);
    case 'proposeVersion': {
      const body = parse(policyInputs.proposeVersion, input);
      return proposeVersion(
        ctx.db,
        {
          sourceId: body.sourceId,
          documentId: body.documentId,
          extraction: body.extraction,
          extractedBy: body.extractedBy,
        },
        ctx.plugins,
      );
    }
    case 'approveVersion': {
      const body = parse(policyInputs.approveVersion, input);
      return approveVersion(ctx.db, { versionId: body.versionId, approvedBy: body.approvedBy }, ctx.plugins);
    }
    case 'rejectVersion': {
      const body = parse(policyInputs.rejectVersion, input);
      return rejectVersion(
        ctx.db,
        { versionId: body.versionId, rejectedBy: body.rejectedBy, reason: body.reason },
        ctx.plugins,
      );
    }
    case 'getPublishedPolicy':
      return getPublishedPolicy(ctx.db, parse(policyInputs.getPublishedPolicy, input).policyKey);
    case 'getPublishedVersion': {
      const body = parse(policyInputs.getPublishedVersion, input);
      return getPublishedVersion(ctx.db, body.policyKey, body.version);
    }
    case 'listPublishedVersions': {
      const body = parse(policyInputs.listPublishedVersions, input);
      return listPublishedVersions(ctx.db, body.policyKey, pageOf(body));
    }
    case 'getVersion':
      return getVersion(ctx.db, parse(policyInputs.getVersion, input).id);
    case 'listVersions': {
      const body = parse(policyInputs.listVersions, input);
      return listVersions(
        ctx.db,
        { status: body.status as VersionStatus | undefined, policyKey: body.policyKey },
        pageOf(body),
      );
    }
    case 'getDiff':
      return getDiff(ctx.db, parse(policyInputs.getDiff, input).id);
    case 'diffForVersion':
      return diffForVersion(ctx.db, parse(policyInputs.diffForVersion, input).versionId);
    case 'saveDiffNotes': {
      const body = parse(policyInputs.saveDiffNotes, input);
      return saveDiffNotes(ctx.db, body.diffId, { summary: body.summary, review: body.review });
    }
    default: {
      const unreachable: never = method;
      throw new AppError('not_found', `Unknown engine method ${String(unreachable)}`);
    }
  }
}

import { initTRPC, TRPCError, type AnyRouter } from '@trpc/server';
import type { OpenApiMeta } from 'trpc-to-openapi';
import type { z } from 'zod';
import { callService } from './errors';
import {
  CheckResult,
  Diff,
  NewPayer,
  NewSource,
  pageOf,
  pageQuery,
  Payer,
  PolicyKey,
  PolicyVersionQuery,
  PolicyVersionsQuery,
  PublishedPolicy,
  RejectVersion,
  Source,
  SourceId,
  Version,
  VersionDetail,
  VersionFilter,
} from './schemas';

export type TrpcContext = {
  apiKey: string | undefined;
  principal: string | undefined;
  services: AnumatServices;
};

type Out<T extends z.ZodType> = z.output<T>;
type Page<T> = { items: T[]; next_cursor: string | null };
type PageInput = { limit: number; cursor?: string | undefined };

export interface AnumatServices {
  createPayer(input: Out<typeof NewPayer>): Promise<Out<typeof Payer>>;
  listPayers(input: PageInput): Promise<Page<Out<typeof Payer>>>;
  createSource(input: Out<typeof NewSource>): Promise<Out<typeof Source>>;
  listSources(input: PageInput): Promise<Page<Out<typeof Source>>>;
  getSource(id: string): Promise<Out<typeof Source>>;
  checkSource(id: string): Promise<Out<typeof CheckResult>>;
  getPolicy(policyKey: string): Promise<Out<typeof PublishedPolicy>>;
  listPolicyVersions(policyKey: string, page: PageInput): Promise<Page<Out<typeof Version>>>;
  getPolicyVersion(policyKey: string, version: number): Promise<Out<typeof PublishedPolicy>>;
  listVersions(filter: Out<typeof VersionFilter>): Promise<Page<Out<typeof Version>>>;
  getVersion(id: string): Promise<Out<typeof VersionDetail>>;
  approveVersion(id: string, principal: string): Promise<Out<typeof Version>>;
  rejectVersion(id: string, reason: string, principal: string): Promise<Out<typeof Version>>;
  getDiff(id: string): Promise<Out<typeof Diff>>;
}

const t = initTRPC.context<TrpcContext>().meta<OpenApiMeta>().create();

export { t };

const authed = t.procedure.use(({ ctx, next }) => {
  if (!ctx.principal) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing or invalid bearer API key' });
  }
  return next({ ctx: { ...ctx, principal: ctx.principal } });
});

const openapi = (method: 'GET' | 'POST', path: `/${string}`) => ({
  openapi: { method, path, protect: true as const },
});

export const appRouter = t.router({
  payers: t.router({
    create: authed
      .meta(openapi('POST', '/payers'))
      .input(NewPayer)
      .output(Payer)
      .mutation(({ ctx, input }) => callService(() => ctx.services.createPayer(input))),
    list: authed
      .meta(openapi('GET', '/payers'))
      .input(pageQuery)
      .output(pageOf(Payer))
      .query(({ ctx, input }) => callService(() => ctx.services.listPayers(input))),
  }),
  sources: t.router({
    create: authed
      .meta(openapi('POST', '/sources'))
      .input(NewSource)
      .output(Source)
      .mutation(({ ctx, input }) => callService(() => ctx.services.createSource(input))),
    list: authed
      .meta(openapi('GET', '/sources'))
      .input(pageQuery)
      .output(pageOf(Source))
      .query(({ ctx, input }) => callService(() => ctx.services.listSources(input))),
    get: authed
      .meta(openapi('GET', '/sources/{id}'))
      .input(SourceId)
      .output(Source)
      .query(({ ctx, input }) => callService(() => ctx.services.getSource(input.id))),
    check: authed
      .meta(openapi('POST', '/sources/{id}/check'))
      .input(SourceId)
      .output(CheckResult)
      .mutation(({ ctx, input }) => callService(() => ctx.services.checkSource(input.id))),
  }),
  policies: t.router({
    get: authed
      .meta(openapi('GET', '/policies/{policyKey}'))
      .input(PolicyKey)
      .output(PublishedPolicy)
      .query(({ ctx, input }) => callService(() => ctx.services.getPolicy(input.policyKey))),
    versions: authed
      .meta(openapi('GET', '/policies/{policyKey}/versions'))
      .input(PolicyVersionsQuery)
      .output(pageOf(Version))
      .query(({ ctx, input }) => callService(() => ctx.services.listPolicyVersions(input.policyKey, input))),
    version: authed
      .meta(openapi('GET', '/policies/{policyKey}/versions/{version}'))
      .input(PolicyVersionQuery)
      .output(PublishedPolicy)
      .query(({ ctx, input }) => callService(() => ctx.services.getPolicyVersion(input.policyKey, input.version))),
  }),
  versions: t.router({
    list: authed
      .meta(openapi('GET', '/versions'))
      .input(VersionFilter)
      .output(pageOf(Version))
      .query(({ ctx, input }) => callService(() => ctx.services.listVersions(input))),
    get: authed
      .meta(openapi('GET', '/versions/{id}'))
      .input(SourceId)
      .output(VersionDetail)
      .query(({ ctx, input }) => callService(() => ctx.services.getVersion(input.id))),
    approve: authed
      .meta(openapi('POST', '/versions/{id}/approve'))
      .input(SourceId)
      .output(Version)
      .mutation(({ ctx, input }) => callService(() => ctx.services.approveVersion(input.id, ctx.principal))),
    reject: authed
      .meta(openapi('POST', '/versions/{id}/reject'))
      .input(RejectVersion)
      .output(Version)
      .mutation(({ ctx, input }) => callService(() => ctx.services.rejectVersion(input.id, input.reason, ctx.principal))),
  }),
  diffs: t.router({
    get: authed
      .meta(openapi('GET', '/diffs/{id}'))
      .input(SourceId)
      .output(Diff)
      .query(({ ctx, input }) => callService(() => ctx.services.getDiff(input.id))),
  }),
});

export type AppRouter = typeof appRouter;

export function mergePluginRouters(plugins: AnyRouter[]) {
  return plugins.reduce((current, plugin) => t.mergeRouters(current, plugin), appRouter);
}

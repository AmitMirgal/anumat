import type { AnumatServices } from '@anumat/contract';
import {
  approveVersion,
  checkSource,
  diffForVersion,
  getDiff,
  getPublishedPolicy,
  getPublishedVersion,
  getSource,
  getVersion,
  listPayers,
  listPublishedVersions,
  listSources,
  listVersions,
  registerPayer,
  registerSource,
  rejectVersion,
  type AppContext,
} from '@anumat/engine';
import { diffDto, pageDto, payerDto, publishedDto, sourceDto, versionDto, watchRunDto } from './http/dto';

export function createServices(ctx: AppContext): AnumatServices {
  const { db } = ctx;
  return {
    createPayer: async (input) => payerDto(await registerPayer(db, input)),
    listPayers: async (input) => pageDto(await listPayers(db, input), payerDto),
    createSource: async (input) => {
      const source = await registerSource(db, {
        payerId: input.payer_id,
        title: input.title,
        sourceUrl: input.source_url,
        policySlug: input.policy_slug,
        market: input.market,
        checkIntervalHours: input.check_interval_hours,
        enabled: input.enabled,
      });
      return sourceDto(source);
    },
    listSources: async (input) => pageDto(await listSources(db, input), sourceDto),
    getSource: async (id) => sourceDto(await getSource(db, id)),
    checkSource: async (id) => {
      const result = await checkSource(ctx, id);
      return {
        watch_run: watchRunDto(result.run),
        version: result.version ? versionDto(result.version) : null,
        diff: result.diff ? diffDto(result.diff) : null,
      };
    },
    getPolicy: async (policyKey) => {
      const version = await getPublishedPolicy(db, policyKey);
      return publishedDto(version, await getSource(db, version.sourceId));
    },
    listPolicyVersions: async (policyKey, page) => pageDto(await listPublishedVersions(db, policyKey, page), versionDto),
    getPolicyVersion: async (policyKey, version) => {
      const row = await getPublishedVersion(db, policyKey, version);
      return publishedDto(row, await getSource(db, row.sourceId));
    },
    listVersions: async (filter) =>
      pageDto(await listVersions(db, { status: filter.status, policyKey: filter.policy_key }, filter), versionDto),
    getVersion: async (id) => {
      const version = await getVersion(db, id);
      return { ...versionDto(version), diff_id: (await diffForVersion(db, version.id)).id };
    },
    approveVersion: async (id, principal) =>
      versionDto(await approveVersion(db, { versionId: id, approvedBy: principal }, ctx.plugins)),
    rejectVersion: async (id, reason, principal) =>
      versionDto(await rejectVersion(db, { versionId: id, rejectedBy: principal, reason }, ctx.plugins)),
    getDiff: async (id) => diffDto(await getDiff(db, id)),
  };
}

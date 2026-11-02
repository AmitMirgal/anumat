import { readFileSync } from 'node:fs';
import { AppError } from '@anumat/core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { closeContext, type AppContext } from '../src/context';
import { createEngine } from '../src/engine';
import * as api from '../src/publish';
import { seedDocument, testDb } from '../src/testing/db';

type PolicyCase = {
  id: string;
  intent: string;
  payer?: { name: string; slug: string; market: string };
  source?: { title: string; source_url: string; policy_slug?: string; check_interval_hours?: number };
  extraction?: { criteria?: string[]; codes?: string[] };
  action: 'approve' | 'reject' | 'propose_only' | 'register_only' | 'get_published';
  reason?: string;
  lookup_policy_key?: string;
  expect?: string;
};

type Outcome = { code: string | null; status: string | null; policyKey: string | null; reason: string | null };

const cases = JSON.parse(readFileSync(new URL('./fixtures/policy_cases.json', import.meta.url), 'utf8')) as PolicyCase[];

const expectedCodes = Object.fromEntries(cases.filter((item) => item.expect).map((item) => [item.id, item.expect]));

let t: Awaited<ReturnType<typeof testDb>>;
let engine: AppContext;

beforeAll(async () => {
  t = await testDb();
  await t.reset();
  engine = await createEngine({ db: t.db });
});

afterAll(async () => {
  await closeContext(engine);
  await t.close();
});

test('the fixture names the expected error codes', () => {
  expect(expectedCodes).toEqual({
    'TEST-PA-05': 'validation_failed',
    'TEST-PA-06': 'validation_failed',
    'TEST-PA-07': 'conflict',
    'TEST-PA-08': 'validation_failed',
    'TEST-PA-10': 'policy_not_published',
  });
});

test('JavaScript policy cases match the shared fixture', async () => {
  for (const item of cases) {
    const outcome = await runCase(item);
    expect(outcome.code, item.id).toBe(item.expect ?? null);
    if (item.action === 'approve' && outcome.code === null) expect(outcome.status, item.id).toBe('approved');
    if (item.action === 'reject' && outcome.code === null) {
      expect(outcome.status, item.id).toBe('rejected');
      expect(outcome.reason, item.id).toBe(item.reason);
    }
    if (item.action === 'propose_only' && outcome.code === null) {
      expect(outcome.status, item.id).toBe('proposed');
      await expect(api.getPublishedPolicy(engine, { policyKey: outcome.policyKey ?? '' }), item.id).rejects.toMatchObject({
        code: 'policy_not_published',
      });
    }
  }
});

async function runCase(item: PolicyCase): Promise<Outcome> {
  try {
    switch (item.action) {
      case 'get_published':
        await api.getPublishedPolicy(engine, { policyKey: item.lookup_policy_key ?? '' });
        return { code: null, status: null, policyKey: item.lookup_policy_key ?? null, reason: null };
      case 'register_only':
      case 'propose_only':
      case 'approve':
      case 'reject':
        return await runMutation(item);
      default: {
        const unreachable: never = item.action;
        throw new Error(unreachable);
      }
    }
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, status: null, policyKey: null, reason: null };
    throw error;
  }
}

async function runMutation(item: PolicyCase): Promise<Outcome> {
  const payerInput = item.payer;
  if (!payerInput) throw new Error(`${item.id} is missing a payer`);
  const payer = await api.registerPayer(engine, {
    name: payerInput.name,
    slug: payerInput.slug,
    market: payerInput.market as 'us',
  });
  if (!item.source) return { code: null, status: null, policyKey: null, reason: null };
  const source = await api.registerSource(engine, {
    payerId: payer.id,
    title: item.source.title,
    sourceUrl: item.source.source_url,
    ...(item.source.policy_slug === undefined ? {} : { policySlug: item.source.policy_slug }),
    ...(item.source.check_interval_hours === undefined ? {} : { checkIntervalHours: item.source.check_interval_hours }),
  });
  if (item.action === 'register_only') return { code: null, status: null, policyKey: source.policyKey, reason: null };
  const document = await seedDocument(t.db, source.id, item.id);
  const proposed = versionOf(
    await api.proposeVersion(engine, {
      sourceId: source.id,
      documentId: document.id,
      extraction: proposalExtraction(item),
      extractedBy: 'TEST',
    }),
  );
  if (item.action === 'propose_only') {
    return { code: null, status: proposed.status, policyKey: source.policyKey, reason: proposed.rejectReason };
  }
  if (item.action === 'approve') {
    const approved = versionOf(await api.approveVersion(engine, { versionId: proposed.id, approvedBy: 'TEST' }));
    return { code: null, status: approved.status, policyKey: source.policyKey, reason: approved.rejectReason };
  }
  const rejected = versionOf(
    await api.rejectVersion(engine, { versionId: proposed.id, rejectedBy: 'TEST', reason: item.reason ?? '' }),
  );
  return { code: null, status: rejected.status, policyKey: source.policyKey, reason: rejected.rejectReason };
}

function proposalExtraction(item: PolicyCase) {
  const criteria = item.extraction?.criteria?.length ? item.extraction.criteria : ['TEST criteria'];
  return {
    market: 'us' as const,
    title: item.source?.title ?? 'TEST Policy',
    payer: item.payer?.name ?? 'TEST Payer',
    policy_number: null,
    effective_date: null,
    revision_date: null,
    auth_type: 'prior_authorization' as const,
    codes: (item.extraction?.codes ?? []).map((code) => ({ system: 'CPT' as const, code })),
    indications: [{ name: 'TEST indication', match: 'all' as const, criteria: criteria.map((text) => ({ text })) }],
    exclusions: [],
    documentation_requirements: [],
    site_of_care: [],
  };
}

function versionOf(value: unknown): { id: string; status: string; rejectReason: string | null } {
  if (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    typeof value.version === 'object' &&
    value.version !== null &&
    'id' in value.version
  ) {
    return versionOf(value.version);
  }
  if (typeof value !== 'object' || value === null || !('id' in value) || !('status' in value)) {
    throw new Error('policy call did not return a version');
  }
  const row = value as { id: string; status: string; rejectReason?: string | null };
  return { id: row.id, status: row.status, rejectReason: row.rejectReason ?? null };
}

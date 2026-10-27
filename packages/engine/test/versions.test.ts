import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import {
  approveVersion,
  getPublishedPolicy,
  getVersion,
  listPublishedVersions,
  proposeVersion,
  rejectVersion,
} from '../src/versions';
import { testDb, seedDocument, seedSource } from '../src/testing/db';
import { bariatricV1, bariatricV2 } from '../src/testing/extraction';

let t: Awaited<ReturnType<typeof testDb>>;
beforeAll(async () => {
  t = await testDb();
});
beforeEach(() => t.reset());
afterAll(() => t.close());

const firstPage = { limit: 10, cursor: undefined };

test('a proposal stays unpublished until a human approves it', async () => {
  const source = await seedSource(t.db);
  const document = await seedDocument(t.db, source.id, 'v1');
  const { version, diff } = await proposeVersion(t.db, {
    sourceId: source.id,
    documentId: document.id,
    extraction: bariatricV1,
    extractedBy: 'test',
  });

  expect({ status: version.status, number: version.version, diffFrom: diff.fromVersionId }).toEqual({
    status: 'proposed',
    number: null,
    diffFrom: null,
  });
  await expect(getPublishedPolicy(t.db, 'uhc.bariatric-surgery')).rejects.toMatchObject({ code: 'policy_not_published' });
  expect((await listPublishedVersions(t.db, 'uhc.bariatric-surgery', firstPage)).items).toEqual([]);

  await approveVersion(t.db, { versionId: version.id, approvedBy: 'reviewer' });
  const published = await getPublishedPolicy(t.db, 'uhc.bariatric-surgery');
  expect({ id: published.id, version: published.version, approvedBy: published.approvedBy }).toEqual({
    id: version.id,
    version: 1,
    approvedBy: 'reviewer',
  });
});

test('an invalid extraction is rejected and nothing is stored', async () => {
  const source = await seedSource(t.db);
  const document = await seedDocument(t.db, source.id, 'v1');
  const invalid = { ...bariatricV1, codes: [{ system: 'CPT', code: 'not-a-code' }] };

  await expect(
    proposeVersion(t.db, { sourceId: source.id, documentId: document.id, extraction: invalid, extractedBy: 'test' }),
  ).rejects.toMatchObject({
    code: 'extraction_invalid',
    details: { issues: [{ path: 'codes.0.code', message: 'Invalid string: must match pattern /^\\d{4}[0-9FTU]$/' }] },
  });
  expect(await t.sql`select count(*)::int as n from policy_versions`).toEqual([{ n: 0 }]);
});

test('a newer document supersedes the open proposal and is diffed against the approved version', async () => {
  const source = await seedSource(t.db);
  const doc1 = await seedDocument(t.db, source.id, 'v1');
  const v1 = await proposeVersion(t.db, { sourceId: source.id, documentId: doc1.id, extraction: bariatricV1, extractedBy: 'test' });
  await approveVersion(t.db, { versionId: v1.version.id, approvedBy: 'reviewer' });

  const doc2 = await seedDocument(t.db, source.id, 'v2');
  const doc3 = await seedDocument(t.db, source.id, 'v3');
  const p2 = await proposeVersion(t.db, { sourceId: source.id, documentId: doc2.id, extraction: bariatricV2, extractedBy: 'test' });
  const p3 = await proposeVersion(t.db, { sourceId: source.id, documentId: doc3.id, extraction: bariatricV2, extractedBy: 'test' });

  expect((await getVersion(t.db, p2.version.id)).status).toBe('superseded');
  expect({ supersedes: p3.version.supersedesId, base: p3.version.baseVersionId, from: p3.diff.fromVersionId }).toEqual({
    supersedes: p2.version.id,
    base: v1.version.id,
    from: v1.version.id,
  });
  expect(p3.diff.diffJson).toEqual([
    { field: 'effective_date', kind: 'changed', before: '2026-05-01', after: '2026-11-01' },
    { field: 'codes', kind: 'added', key: 'CPT 43645', after: bariatricV2.codes[2] },
  ]);
  await expect(approveVersion(t.db, { versionId: p2.version.id, approvedBy: 'reviewer' })).rejects.toMatchObject({
    code: 'version_not_proposed',
    details: { status: 'superseded' },
  });
  expect((await approveVersion(t.db, { versionId: p3.version.id, approvedBy: 'reviewer' })).version).toBe(2);
});

test('proposing the same document twice returns the first version', async () => {
  const source = await seedSource(t.db);
  const document = await seedDocument(t.db, source.id, 'v1');
  const input = { sourceId: source.id, documentId: document.id, extraction: bariatricV1, extractedBy: 'test' };
  const first = await proposeVersion(t.db, input);
  const second = await proposeVersion(t.db, input);
  expect({ created: second.created, id: second.version.id, diff: second.diff.id }).toEqual({
    created: false,
    id: first.version.id,
    diff: first.diff.id,
  });
});

test('concurrent approvals publish one version, and decided versions cannot change', async () => {
  const source = await seedSource(t.db);
  const document = await seedDocument(t.db, source.id, 'v1');
  const { version } = await proposeVersion(t.db, {
    sourceId: source.id,
    documentId: document.id,
    extraction: bariatricV1,
    extractedBy: 'test',
  });

  const approvals = await Promise.all([
    approveVersion(t.db, { versionId: version.id, approvedBy: 'alice' }),
    approveVersion(t.db, { versionId: version.id, approvedBy: 'bob' }),
  ]);
  expect(approvals.map((v) => v.version)).toEqual([1, 1]);
  expect(approvals[0]?.approvedBy).toBe(approvals[1]?.approvedBy);
  await expect(
    rejectVersion(t.db, { versionId: version.id, rejectedBy: 'carol', reason: 'late' }),
  ).rejects.toMatchObject({ code: 'version_not_proposed', details: { status: 'approved' } });
  await expect(
    t.sql`update policy_versions set extracted_json = '{}'::jsonb where id = ${version.id}`,
  ).rejects.toThrow(`policy version ${version.id} is approved and cannot change`);
});

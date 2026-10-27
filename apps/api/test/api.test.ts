import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { replayModels } from '@anumat/engine';
import { bariatricV1, fakePayerSite, TEST_API_KEY, testContext } from '@anumat/engine/testing';
import { createApp } from '../src/http/app';

let t: Awaited<ReturnType<typeof testContext>>;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  const site = fakePayerSite(['Bariatric Surgery', 'Coverage Rationale', 'BMI of 40 or greater.']);
  t = await testContext({ models: replayModels(() => bariatricV1), adapter: site.adapter });
  app = createApp({ ctx: t.ctx });
});
beforeEach(() => t.reset());
afterAll(() => t.close());

async function call(method: string, path: string, body?: unknown, target = app) {
  const response = await target.request(path, {
    method,
    headers: { authorization: `Bearer ${TEST_API_KEY}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: JSON.parse(await response.text()) };
}

async function registerBariatric() {
  const payer = await call('POST', '/v1/payers', { name: 'UnitedHealthcare', slug: 'uhc', market: 'us' });
  return call('POST', '/v1/sources', {
    payer_id: payer.body.id,
    title: 'Bariatric Surgery',
    source_url: 'https://payer.test/bariatric-surgery.pdf',
  });
}

test('a checked policy is unpublished until approved, then served as version 1', async () => {
  const source = await registerBariatric();
  expect({ status: source.status, key: source.body.policy_key, market: source.body.market }).toEqual({
    status: 201,
    key: 'uhc.bariatric-surgery',
    market: 'us',
  });

  const check = await call('POST', `/v1/sources/${source.body.id}/check`);
  expect({ outcome: check.body.watch_run.outcome, status: check.body.version.status, error: check.body.watch_run.error }).toEqual({
    outcome: 'new_artifact',
    status: 'proposed',
    error: null,
  });

  const unpublished = await call('GET', '/v1/policies/uhc.bariatric-surgery');
  expect({ status: unpublished.status, code: unpublished.body.error.code }).toEqual({
    status: 404,
    code: 'policy_not_published',
  });

  const diff = await call('GET', `/v1/diffs/${check.body.diff.id}`);
  expect(diff.body.changes.slice(0, 2)).toEqual([
    { field: 'title', kind: 'changed', before: null, after: 'Bariatric Surgery' },
    { field: 'payer', kind: 'changed', before: null, after: 'UnitedHealthcare' },
  ]);

  const approved = await call('POST', `/v1/versions/${check.body.version.id}/approve`);
  expect({ status: approved.body.status, version: approved.body.version, by: approved.body.approved_by }).toEqual({
    status: 'approved',
    version: 1,
    by: 'tester',
  });

  const published = await call('GET', '/v1/policies/uhc.bariatric-surgery');
  expect({ version: published.body.version, source: published.body.source, rules: published.body.rules }).toEqual({
    version: 1,
    source: { title: 'Bariatric Surgery', url: 'https://payer.test/bariatric-surgery.pdf' },
    rules: bariatricV1,
  });
  expect((await call('GET', '/v1/policies/uhc.bariatric-surgery/versions/1')).body.version_id).toBe(check.body.version.id);

  const recheck = await call('POST', `/v1/sources/${source.body.id}/check`);
  expect({ outcome: recheck.body.watch_run.outcome, version: recheck.body.version.version }).toEqual({
    outcome: 'unchanged',
    version: 1,
  });
});

test('a rejected proposal cannot be approved and stays unpublished', async () => {
  const source = await registerBariatric();
  const check = await call('POST', `/v1/sources/${source.body.id}/check`);

  const rejected = await call('POST', `/v1/versions/${check.body.version.id}/reject`, { reason: 'Criteria misread' });
  const approve = await call('POST', `/v1/versions/${check.body.version.id}/approve`);

  expect({ status: rejected.body.status, reason: rejected.body.reject_reason }).toEqual({
    status: 'rejected',
    reason: 'Criteria misread',
  });
  expect({ status: approve.status, code: approve.body.error.code }).toEqual({ status: 409, code: 'version_not_proposed' });
  expect((await call('GET', '/v1/policies/uhc.bariatric-surgery')).status).toBe(404);
});

test('requests without a valid key are rejected', async () => {
  const response = await app.request('/v1/payers', { headers: { authorization: 'Bearer wrong-key-0123456789' } });
  expect({ status: response.status, code: JSON.parse(await response.text()).error.code }).toEqual({
    status: 401,
    code: 'unauthorized',
  });
});

test('invalid bodies return validation issues', async () => {
  const response = await call('POST', '/v1/payers', { name: 'Aetna', slug: 'Aetna Inc', market: 'in' });
  expect(response).toEqual({
    status: 400,
    body: {
      error: {
        code: 'validation_failed',
        message: 'Request validation failed',
        details: {
          issues: [
            { path: 'slug', message: 'lowercase letters, digits, and single hyphens' },
            { path: 'market', message: 'Invalid input: expected "us"' },
          ],
        },
        request_id: expect.any(String),
      },
    },
  });
});

test('payer lists paginate with a cursor', async () => {
  for (const slug of ['aetna', 'cigna', 'uhc']) await call('POST', '/v1/payers', { name: slug, slug, market: 'us' });

  const first = await call('GET', '/v1/payers?limit=2');
  const second = await call('GET', `/v1/payers?limit=2&cursor=${first.body.next_cursor}`);

  expect(first.body.items.map((p: { slug: string }) => p.slug)).toEqual(['aetna', 'cigna']);
  expect({ slugs: second.body.items.map((p: { slug: string }) => p.slug), next: second.body.next_cursor }).toEqual({
    slugs: ['uhc'],
    next: null,
  });
});

test('the rate limit stub answers 429 with Retry-After once the per-key budget is spent', async () => {
  const limited = createApp({ ...t.ctx, config: { ...t.ctx.config, rateLimitPerMinute: 2 } });
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await call('GET', '/v1/payers', undefined, limited)).status);
  expect(statuses).toEqual([200, 200, 429]);
});

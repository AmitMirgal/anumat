import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import type { AuditRecord, AuditSink } from '@anumat/core';
import { replayModels } from '@anumat/engine';
import { bariatricV1, fakePayerSite, TEST_API_KEY, testContext } from '@anumat/engine/testing';
import { createApp } from '../src/http/app';

let t: Awaited<ReturnType<typeof testContext>>;
const records: AuditRecord[] = [];
const audit: AuditSink = {
  async record(event) {
    records.push(event);
  },
};

beforeAll(async () => {
  const site = fakePayerSite(['Bariatric Surgery', 'Coverage Rationale', 'BMI of 40 or greater.']);
  t = await testContext({ models: replayModels(() => bariatricV1), adapter: site.adapter });
});
beforeEach(async () => {
  records.length = 0;
  await t.reset();
});
afterAll(() => t.close());

test('an in-memory AuditSink replaces the no-op default', async () => {
  const app = createApp({ ctx: t.ctx, plugins: { audit } });
  const headers = { authorization: `Bearer ${TEST_API_KEY}`, 'content-type': 'application/json' };
  const payer = await app.request('/v1/payers', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'UnitedHealthcare', slug: 'uhc', market: 'us' }),
  });
  const payerBody = (await payer.json()) as { id: string };
  const source = await app.request('/v1/sources', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      payer_id: payerBody.id,
      title: 'Bariatric Surgery',
      source_url: 'https://payer.test/bariatric-surgery.pdf',
    }),
  });
  const sourceBody = (await source.json()) as { id: string };
  const check = await app.request(`/v1/sources/${sourceBody.id}/check`, { method: 'POST', headers });
  const checkBody = (await check.json()) as { version: { id: string } };
  const approved = await app.request(`/v1/versions/${checkBody.version.id}/approve`, { method: 'POST', headers });

  expect(approved.status).toBe(200);
  expect(records.map((record) => record.action)).toEqual(['proposed', 'approved']);
  expect(records.every((record) => record.policyKey === 'uhc.bariatric-surgery')).toBe(true);
});

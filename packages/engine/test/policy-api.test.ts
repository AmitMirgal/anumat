import { readFileSync } from 'node:fs';
import { AppError } from '@anumat/core';
import { expect, test } from 'vitest';
import { slugify } from '../src/catalog';
import * as api from '../src/publish';
import { callEngineMethod } from '../src/sidecar-rpc';
import type { AppContext } from '../src/context';
import type { PolicyMethod } from '../src/policy-api';

const methods = JSON.parse(readFileSync(new URL('../policy-cases.json', import.meta.url), 'utf8')) as {
  methods: { javascript: PolicyMethod; python: string }[];
  invalid: { javascript: PolicyMethod; python: string; input: unknown; code: string }[];
};

const slugs = JSON.parse(readFileSync(new URL('./slugify-fixtures.json', import.meta.url), 'utf8')) as {
  input: string;
  slug: string;
}[];

test('slugify matches the shared vectors', () => {
  for (const vector of slugs) expect(slugify(vector.input), vector.input).toBe(vector.slug);
});

test('the published engine exports each policy method', () => {
  for (const method of methods.methods) {
    expect(typeof api[method.javascript], method.javascript).toBe('function');
  }
});

const snakeKey: Record<string, string> = {
  payerId: 'payer_id',
  sourceUrl: 'source_url',
  policySlug: 'policy_slug',
  checkIntervalHours: 'check_interval_hours',
  sourceId: 'source_id',
  documentId: 'document_id',
  extractedBy: 'extracted_by',
  versionId: 'version_id',
  approvedBy: 'approved_by',
  rejectedBy: 'rejected_by',
  policyKey: 'policy_key',
  diffId: 'diff_id',
};

function snakeInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) out[snakeKey[key] ?? key] = value;
  return out;
}

test('invalid policy calls fail before they touch the database', async () => {
  const engine = {} as api.Engine;
  const ctx = {} as AppContext;
  for (const item of methods.invalid) {
    const call = api[item.javascript] as (engine: api.Engine, input: unknown) => Promise<unknown>;
    await expect(call(engine, item.input), item.javascript).rejects.toBeInstanceOf(AppError);
    await expect(call(engine, item.input), item.javascript).rejects.toMatchObject({ code: item.code });
    await expect(callEngineMethod(ctx, item.python, snakeInput(item.input)), item.python).rejects.toMatchObject({
      code: item.code,
    });
  }
});

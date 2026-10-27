import { afterEach, expect, test } from 'vitest';
import { replayModels } from '../src/agent/replay-model';
import { checkSource, dueSources } from '../src/pipeline/check';
import { getVersion } from '../src/versions';
import { testContext, fakePayerSite } from '../src/testing/context';
import { seedSource } from '../src/testing/db';
import { bariatricV1, bariatricV2 } from '../src/testing/extraction';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup(extraction: () => unknown) {
  const site = fakePayerSite(['Bariatric Surgery', 'Coverage Rationale', 'BMI of 40 or greater.']);
  const t = await testContext({ models: replayModels(extraction), adapter: site.adapter });
  close = t.close;
  await t.reset();
  return { ...t, site, source: await seedSource(t.ctx.db) };
}

test('checking the same PDF twice creates one artifact and one version', async () => {
  const { ctx, source, counts } = await setup(() => bariatricV1);

  const first = await checkSource(ctx, source.id);
  const second = await checkSource(ctx, source.id);

  expect([first.run.outcome, second.run.outcome]).toEqual(['new_artifact', 'unchanged']);
  expect({ status: first.version?.status, sameVersion: second.version?.id === first.version?.id }).toEqual({
    status: 'proposed',
    sameVersion: true,
  });
  expect(await counts()).toEqual({ artifacts: 1, documents: 1, versions: 1, runs: 2 });
});

test('a changed PDF creates a new proposal that supersedes the open one', async () => {
  let extraction: unknown = bariatricV1;
  const { ctx, source, site, counts } = await setup(() => extraction);
  const first = await checkSource(ctx, source.id);

  site.publish(['Bariatric Surgery', 'Coverage Rationale', 'Effective November 1, 2026.']);
  extraction = bariatricV2;
  const second = await checkSource(ctx, source.id);

  expect(second.run.outcome).toBe('new_artifact');
  expect((await getVersion(ctx.db, first.version?.id ?? '')).status).toBe('superseded');
  expect({ status: second.version?.status, supersedes: second.version?.supersedesId }).toEqual({
    status: 'proposed',
    supersedes: first.version?.id,
  });
  expect(await counts()).toEqual({ artifacts: 2, documents: 2, versions: 2, runs: 2 });
});

test('a failed extraction resumes on the next check without a new artifact', async () => {
  let ready = false;
  const { ctx, source, counts } = await setup(() => (ready ? bariatricV1 : undefined));

  const failed = await checkSource(ctx, source.id);
  ready = true;
  const resumed = await checkSource(ctx, source.id);

  expect({ outcome: failed.run.outcome, code: failed.run.errorCode, stored: failed.run.artifactId !== null }).toEqual({
    outcome: 'error',
    code: 'extraction_failed',
    stored: true,
  });
  expect({ outcome: resumed.run.outcome, status: resumed.version?.status }).toEqual({
    outcome: 'unchanged',
    status: 'proposed',
  });
  expect(await counts()).toEqual({ artifacts: 1, documents: 1, versions: 1, runs: 2 });
});

test('a source is due until it has a run inside its check interval', async () => {
  const { ctx, source } = await setup(() => bariatricV1);
  expect((await dueSources(ctx)).map((due) => due.policyKey)).toEqual([source.policyKey]);
  await checkSource(ctx, source.id);
  expect((await dueSources(ctx)).map((due) => due.policyKey)).toEqual([]);
});

test('without an LLM key the watch run records llm_not_configured and keeps the converted document', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const site = fakePayerSite(['Bariatric Surgery']);
    const t = await testContext({
      models: { kind: 'router', strong: 'anthropic/claude-sonnet-4-5', cheap: 'anthropic/claude-haiku-4-5' },
      adapter: site.adapter,
    });
    close = t.close;
    await t.reset();
    const source = await seedSource(t.ctx.db);

    const result = await checkSource(t.ctx, source.id);

    expect({ outcome: result.run.outcome, code: result.run.errorCode, message: result.run.errorMessage }).toEqual({
      outcome: 'error',
      code: 'llm_not_configured',
      message: 'No API key is configured for anthropic/claude-haiku-4-5. Set ANTHROPIC_API_KEY to run the triage step.',
    });
    expect(await t.counts()).toEqual({ artifacts: 1, documents: 1, versions: 0, runs: 1 });
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

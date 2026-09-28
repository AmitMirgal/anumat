import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createPolicyAgent } from '../src/agent/policy-agent';
import { fixtureExtractions, replayModels, toolCall, toolResults } from '../src/agent/replay-model';
import type { AgentSources } from '../src/agent/tools';
import { scriptedModels } from './support/models';

const DOC = '6f1c1c52-0c1e-4a36-9d6a-3d8f6f0b9a11';
const DIFF = '0d6a3c55-8f5e-4a4b-9a57-6a2f2b8f7c10';
const fixture = 'evals/fixtures/uhc.bariatric-surgery';
const markdown = readFileSync(`${fixture}/document.md`, 'utf8');
const gold: unknown = JSON.parse(readFileSync(`${fixture}/expected.json`, 'utf8'));
const sources: AgentSources = { markdown: async () => markdown, approvedExtraction: async () => null };
const job = { documentId: DOC, policyKey: 'uhc.bariatric-surgery', payer: 'UnitedHealthcare', title: 'Bariatric Surgery' };
const triageTo = (sectionIds: string[]) => () =>
  toolCall('save_triage', {
    document_id: DOC,
    triage: { is_prior_auth_policy: true, section_ids: sectionIds, reason: 'Coverage criteria and codes' },
  });

test('the replay model extracts through the agent tools and reads only rule sections', async () => {
  const models = replayModels(fixtureExtractions('evals/fixtures', 'expected.json'));
  const agent = await createPolicyAgent({ market: 'us', models, sources });
  const result = await agent.extractDocument(job);
  const ruleSections = ['coverage-rationale', 'medical-records-documentation-used-for-reviews', 'applicable-codes'];
  expect(result.extraction).toEqual(gold);
  expect({ model: result.model, triage: result.triage.section_ids, read: result.sectionsRead }).toEqual({
    model: 'replay/extract',
    triage: ruleSections,
    read: ruleSections,
  });
});

test('save_extraction rejects output that fails the US schema and keeps the corrected call', async () => {
  const invalid = { ...(gold as object), codes: [{ system: 'CPT', code: '4364' }] };
  const models = scriptedModels({
    triage: [() => toolCall('get_policy_document', { document_id: DOC }), triageTo(['coverage-rationale'])],
    extract: [
      () => toolCall('get_policy_document', { document_id: DOC, section_ids: ['coverage-rationale'] }),
      () => toolCall('save_extraction', { document_id: DOC, extraction: invalid }),
      () => toolCall('save_extraction', { document_id: DOC, extraction: gold }),
    ],
  });
  const agent = await createPolicyAgent({ market: 'us', models: models.source, sources });

  expect((await agent.extractDocument(job)).extraction).toEqual(gold);
  const rejection = toolResults(models.calls('extract')[2]?.prompt ?? []).find((r) => r.toolName === 'save_extraction');
  expect(rejection?.value).toMatchObject({ error: true, message: expect.stringContaining('extraction.codes.0.code') });
});

test('the extract path fails with llm_not_configured when the provider key is missing', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const agent = await createPolicyAgent({
      market: 'us',
      models: { kind: 'router', strong: 'anthropic/claude-sonnet-4-5', cheap: 'anthropic/claude-haiku-4-5' },
      sources,
    });
    await expect(agent.extractDocument(job)).rejects.toMatchObject({
      code: 'llm_not_configured',
      details: { mode: 'triage', model: 'anthropic/claude-haiku-4-5', env_var: 'ANTHROPIC_API_KEY' },
    });
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('tools refuse ids outside the job, and triage can stop a non-policy document', async () => {
  const models = scriptedModels({
    triage: [
      () => toolCall('get_policy_document', { document_id: 'another-document' }),
      () =>
        toolCall('save_triage', {
          document_id: DOC,
          triage: { is_prior_auth_policy: false, section_ids: [], reason: 'Retired policy notice' },
        }),
    ],
  });
  const agent = await createPolicyAgent({ market: 'us', models: models.source, sources });

  await expect(agent.extractDocument(job)).rejects.toMatchObject({
    code: 'not_a_policy',
    message: `Triage found no prior-auth rules in document ${DOC}: Retired policy notice`,
  });
  expect(toolResults(models.calls('triage')[1]?.prompt ?? [])[0]?.value).toEqual({
    error: true,
    message: 'Document another-document is not part of this job',
  });
});

test('annotateDiff returns the diff summary and the review findings', async () => {
  const review = {
    verdict: 'needs_attention',
    findings: [{ field: 'codes', note: 'CPT 43645 does not appear in Applicable Codes.' }],
  };
  const models = scriptedModels({
    diff: [() => toolCall('save_diff', { diff_id: DIFF, summary: 'Adds CPT 43645 and moves the effective date to November 1.' })],
    review: [
      () => toolCall('get_policy_document', { document_id: DOC, section_ids: ['applicable-codes'] }),
      () => toolCall('save_diff', { diff_id: DIFF, review }),
    ],
  });
  const agent = await createPolicyAgent({ market: 'us', models: models.source, sources });

  expect(
    await agent.annotateDiff({
      diffId: DIFF,
      documentId: DOC,
      policyKey: 'uhc.bariatric-surgery',
      changes: [{ field: 'codes', kind: 'added', key: 'CPT 43645' }],
    }),
  ).toEqual({ summary: 'Adds CPT 43645 and moves the effective date to November 1.', review, failures: [] });
});

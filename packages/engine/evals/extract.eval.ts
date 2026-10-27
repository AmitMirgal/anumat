import { runEvals } from '@mastra/core/evals';
import { expectEvals } from '@mastra/evals/vitest';
import { expect, test } from 'vitest';
import { createPolicyAgent } from '../src/agent/policy-agent';
import { extractionCases } from './cases';
import { codeOverlap, criteriaJudge, criteriaSimilarity, requiredFields, schemaValidity } from './scorers';
import { extractionWorkflow, LIVE, routerModels } from './workflows';

const cases = extractionCases();
const judge = await (
  await createPolicyAgent({
    market: 'us',
    models: routerModels,
    sources: { markdown: async () => '', approvedExtraction: async () => null },
  })
).modelStatus('review');

test(`US extraction meets the gold fixtures (${LIVE ? 'live model' : 'offline replay of candidate.json'})`, async () => {
  const result = await expectEvals({
    target: extractionWorkflow,
    data: cases.map((c) => ({ input: { case_id: c.id, replay: c.candidate }, groundTruth: c.expected })),
    gates: [schemaValidity],
    scorers: [
      { scorer: requiredFields, threshold: 0.9 },
      { scorer: codeOverlap, threshold: 0.85 },
      { scorer: criteriaSimilarity, threshold: 0.75 },
      { scorer: criteriaJudge({ model: judge.model, available: judge.hasAuth }), threshold: 0.7 },
    ],
  }).toPass();
  if (!judge.hasAuth) expect(result.summary.notScorable).toEqual({ 'criteria-judge': cases.length });
});

test.skipIf(LIVE)('an extraction that breaks extractSchemas.us fails the schema gate', async () => {
  const [first] = cases;
  if (!first) throw new Error('No extraction fixtures found');
  const broken = { ...(first.candidate as object), market: 'in', effective_date: '05/01/2026' };
  const result = await runEvals({
    target: extractionWorkflow,
    data: [{ input: { case_id: first.id, replay: broken }, groundTruth: first.expected }],
    gates: [schemaValidity],
    scorers: [],
  });
  expect({ verdict: result.verdict, gates: result.gateResults }).toEqual({
    verdict: 'failed',
    gates: [{ id: 'schema-validity', passed: false, score: 0 }],
  });
});

import { expectEvals } from '@mastra/evals/vitest';
import { test } from 'vitest';
import { diffCases } from './cases';
import { changesMatchGold } from './scorers';
import { diffWorkflow } from './workflows';

test('the US diff reproduces the expected change sets', async () => {
  await expectEvals({
    target: diffWorkflow,
    data: diffCases().map((c) => ({ input: { previous: c.previous, current: c.current }, groundTruth: c.expected })),
    gates: [changesMatchGold],
  }).toPass();
});

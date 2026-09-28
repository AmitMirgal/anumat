import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { createPolicyAgent, type ModelSource } from '../src/agent/policy-agent';
import { replayModels } from '../src/agent/replay-model';
import { DEFAULT_MODELS } from '../src/config';
import { toAppError } from '../src/errors';
import { markets } from '../src/markets/registry';
import { extractionCases } from './cases';

export const LIVE = process.env.ANUMAT_EVAL_LIVE === '1';
export const routerModels: ModelSource = {
  kind: 'router',
  strong: process.env.ANUMAT_STRONG_MODEL || DEFAULT_MODELS.strong,
  cheap: process.env.ANUMAT_CHEAP_MODEL || DEFAULT_MODELS.cheap,
};

const EVAL_DOCUMENT_ID = '00000000-0000-4000-8000-000000000001';
const cases = new Map(extractionCases().map((c) => [c.id, c]));

export const ExtractionInput = z.object({ case_id: z.string(), replay: z.unknown() });
export const ExtractionOutput = z.object({
  extraction: z.unknown(),
  error: z.string().nullable(),
  model: z.string().nullable(),
  chars_read: z.number(),
  document_chars: z.number(),
});

const extractStep = createStep({
  id: 'extract-policy',
  inputSchema: ExtractionInput,
  outputSchema: ExtractionOutput,
  execute: async ({ inputData }) => {
    const fixture = cases.get(inputData.case_id);
    if (!fixture) throw new Error(`Unknown eval case ${inputData.case_id}`);
    const agent = await createPolicyAgent({
      market: 'us',
      models: LIVE ? routerModels : replayModels(() => inputData.replay),
      sources: { markdown: async () => fixture.document, approvedExtraction: async () => null },
    });
    const job = { documentId: EVAL_DOCUMENT_ID, policyKey: fixture.policyKey, payer: fixture.payer, title: fixture.title };
    try {
      const result = await agent.extractDocument(job);
      return {
        extraction: result.extraction,
        error: null,
        model: result.model,
        chars_read: result.charsRead,
        document_chars: fixture.document.length,
      };
    } catch (error) {
      return { extraction: null, error: toAppError(error).message, model: null, chars_read: 0, document_chars: fixture.document.length };
    }
  },
});

export const extractionWorkflow = createWorkflow({
  id: 'anumat-extraction-eval',
  inputSchema: ExtractionInput,
  outputSchema: ExtractionOutput,
})
  .then(extractStep)
  .commit();

export const DiffInput = z.object({ previous: z.unknown(), current: z.unknown() });
export const DiffOutput = z.object({ changes: z.array(z.unknown()) });

const diffStep = createStep({
  id: 'diff-policy',
  inputSchema: DiffInput,
  outputSchema: DiffOutput,
  execute: async ({ inputData }) => {
    const us = markets.us;
    return { changes: us.diff(us.extractSchema.parse(inputData.previous), us.extractSchema.parse(inputData.current)) };
  },
});

export const diffWorkflow = createWorkflow({ id: 'anumat-diff-eval', inputSchema: DiffInput, outputSchema: DiffOutput })
  .then(diffStep)
  .commit();

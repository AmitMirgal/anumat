import { isDeepStrictEqual } from 'node:util';
import { createScorer, notScorable } from '@mastra/core/evals';
import { z } from 'zod';
import { extractSchemas } from '../src/markets/registry';
import { renderCriterion } from '../src/markets/us/diff';
import type { UsExtraction } from '../src/markets/us/extract-schema';
import { DiffOutput, ExtractionOutput } from './workflows';

const usExtraction = (value: unknown): UsExtraction | null => {
  const parsed = extractSchemas.us.safeParse(value);
  return parsed.success ? parsed.data : null;
};
const extractionOf = (run: { output: unknown }) => usExtraction(ExtractionOutput.parse(run.output).extraction);
const pairOf = (run: { output: unknown; groundTruth?: unknown }) => {
  const extraction = extractionOf(run);
  const gold = usExtraction(run.groundTruth);
  return extraction && gold ? { extraction, gold } : null;
};

const criteriaOf = (extraction: UsExtraction) =>
  extraction.indications.flatMap((indication) => indication.criteria.map(renderCriterion));

const tokens = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9.]+/).filter((token) => token.length > 2));

function tokenF1(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  const overlap = [...left].filter((token) => right.has(token)).length;
  if (overlap === 0) return 0;
  const precision = overlap / right.size;
  const recall = overlap / left.size;
  return (2 * precision * recall) / (precision + recall);
}

const bestMatchMean = (from: string[], to: string[]) =>
  from.length === 0 ? (to.length === 0 ? 1 : 0) : from.reduce((sum, a) => sum + Math.max(0, ...to.map((b) => tokenF1(a, b))), 0) / from.length;

const f1 = (precision: number, recall: number) =>
  precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

export const schemaValidity = createScorer({
  id: 'schema-validity',
  description: 'The run saved an extraction and it passes extractSchemas.us',
}).generateScore(({ run }) => (extractionOf(run) ? 1 : 0));

const REQUIRED_FIELDS = [
  'title',
  'payer',
  'policy_number',
  'effective_date',
  'revision_date',
  'auth_type',
  'codes',
  'indications',
  'exclusions',
  'documentation_requirements',
  'site_of_care',
] as const satisfies readonly (keyof UsExtraction)[];

const filled = (value: unknown) => (Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined);

export const requiredFields = createScorer({
  id: 'required-field-completeness',
  description: 'Share of the fields the gold fills that the extraction also fills',
}).generateScore(({ run }) => {
  const pair = pairOf(run);
  if (!pair) return 0;
  const expected = REQUIRED_FIELDS.filter((field) => filled(pair.gold[field]));
  if (expected.length === 0) return 1;
  return expected.filter((field) => filled(pair.extraction[field])).length / expected.length;
});

export const codeOverlap = createScorer({
  id: 'code-overlap',
  description: 'F1 of the extracted code list against the gold codes, matched on system and code',
}).generateScore(({ run }) => {
  const pair = pairOf(run);
  if (!pair) return 0;
  const keys = (codes: UsExtraction['codes']) => new Set(codes.map((code) => `${code.system} ${code.code}`));
  const extracted = keys(pair.extraction.codes);
  const gold = keys(pair.gold.codes);
  if (gold.size === 0 && extracted.size === 0) return 1;
  const hits = [...extracted].filter((key) => gold.has(key)).length;
  return f1(extracted.size ? hits / extracted.size : 0, gold.size ? hits / gold.size : 0);
});

export const criteriaSimilarity = createScorer({
  id: 'criteria-similarity',
  description: 'Token-overlap F1 between extracted and gold criteria, each matched to its closest counterpart',
}).generateScore(({ run }) => {
  const pair = pairOf(run);
  if (!pair) return 0;
  const extracted = criteriaOf(pair.extraction);
  const gold = criteriaOf(pair.gold);
  return f1(bestMatchMean(extracted, gold), bestMatchMean(gold, extracted));
});

export function criteriaJudge(options: { model: string; available: boolean }) {
  return createScorer({
    id: 'criteria-judge',
    description: 'LLM judge: share of gold criteria the extraction states with the same clinical meaning',
    judge: {
      model: options.model,
      instructions: 'You grade prior-authorization policy extractions. Compare criteria by clinical meaning, not wording.',
    },
  })
    .preprocess(({ run }) => {
      if (!options.available) return notScorable(`No API key for judge model ${options.model}`);
      const pair = pairOf(run);
      if (!pair) return notScorable('The extraction or the gold failed extractSchemas.us');
      return { gold: criteriaOf(pair.gold), extracted: criteriaOf(pair.extraction) };
    })
    .analyze({
      description: 'Count gold criteria stated in the extraction',
      outputSchema: z.object({ matched: z.number().int().min(0), total: z.number().int().min(1) }),
      createPrompt: ({ results }) =>
        [
          'Gold criteria, one per line:',
          ...results.preprocessStepResult.gold,
          '',
          'Extracted criteria, one per line:',
          ...results.preprocessStepResult.extracted,
          '',
          'Count the gold criteria that the extracted list states with the same clinical meaning.',
          'Return matched, and total as the number of gold criteria.',
        ].join('\n'),
    })
    .generateScore(({ results }) => Math.min(1, results.analyzeStepResult.matched / results.analyzeStepResult.total));
}

export const changesMatchGold = createScorer({
  id: 'diff-matches-gold',
  description: 'The computed change set equals the expected change set',
}).generateScore(({ run }) => (isDeepStrictEqual(DiffOutput.parse(run.output).changes, run.groundTruth) ? 1 : 0));

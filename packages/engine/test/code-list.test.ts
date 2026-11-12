import { expect, test } from 'vitest';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { AppError } from '@anumat/core';
import { extractSchemas } from '@anumat/markets';
import { createPolicyAgent } from '../src/agent/policy-agent';
import { replayModels, toolCall, type StreamResult } from '../src/agent/replay-model';
import type { AgentSources } from '../src/agent/tools';
import { conversionQualityError, pdfToMarkdown } from '../src/convert/pdf-to-markdown';
import { isCodeListDocument, recoverCodeListTriage } from '../src/documents/code-list';
import { outline } from '../src/documents/outline';
import { closeContext } from '../src/context';
import { DEFAULT_MODELS, MODEL_EXAMPLES } from '../src/config';
import { createEngine } from '../src/engine';
import { extractFromPdf } from '../src/extract';
import { priorAuthCodeList } from '../src/testing/extraction';
import { scriptedModels } from '../src/testing/models';
import {
  headinglessPriorAuthCodeListPdf,
  PRIOR_AUTH_CODE_LIST_ROWS,
  priorAuthCodeListPdf,
  textPdf,
} from '../src/testing/pdf';

const CODE_LIST_MARKDOWN = [
  'UnitedHealthcare',
  '',
  'This bulletin is effective January 1, 2026.',
  '',
  '|Policy Name|CPT Code|',
  '|---|---|',
  '|Bariatric Surgery|43644|',
  '|Bariatric Surgery|43645|',
  '|Bariatric Surgery|43775|',
  '|Obstructive Sleep Apnea Treatment|95810|',
  '|Obstructive Sleep Apnea Treatment|95811|',
].join('\n');

const RETIRED_NOTICE = 'This policy is retired. See the index of medical policies.\n';
const DOC = '6f1c1c52-0c1e-4a36-9d6a-3d8f6f0b9a11';
const job = {
  documentId: DOC,
  policyKey: 'example.prior-auth-code-list',
  payer: priorAuthCodeList.payer,
  title: priorAuthCodeList.title,
};
const hasGoogle = Boolean(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);

type CallOptions = Parameters<MastraLanguageModelV2Mock['doStream']>[0];

function documentIdFrom(options: CallOptions): string {
  const text = options.prompt
    .flatMap((message) =>
      message.role === 'user' ? message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])) : [],
    )
    .join('\n');
  return /document ([0-9a-f-]{36})/.exec(text)?.[1] ?? DOC;
}

function geminiStyleReject() {
  const withId = (run: (documentId: string) => StreamResult) => (options: CallOptions) => run(documentIdFrom(options));
  return scriptedModels(
    {
      triage: [
        withId((documentId) => toolCall('get_policy_document', { document_id: documentId })),
        withId((documentId) =>
          toolCall('save_triage', {
            document_id: documentId,
            triage: {
              is_prior_auth_policy: false,
              section_ids: [],
              reason: 'The document only contains a preamble and no policy sections like coverage criteria or codes.',
            },
          }),
        ),
      ],
      extract: [
        withId((documentId) => toolCall('get_policy_document', { document_id: documentId, section_ids: ['preamble'] })),
        withId((documentId) => toolCall('save_extraction', { document_id: documentId, extraction: priorAuthCodeList })),
      ],
    },
    'google',
  );
}

test('anydoc converts a two-column policy-name/CPT table with the table intact', async () => {
  const titled = await pdfToMarkdown(priorAuthCodeListPdf(), { apiKey: undefined, apiUrl: undefined });
  expect(titled.converter).toBe('anydoc');
  expect(titled.markdown).toMatch(/\|Policy Name\|CPT Code\|/);
  for (const row of PRIOR_AUTH_CODE_LIST_ROWS) {
    expect(titled.markdown).toContain(`|${row.policy}|${row.code}|`);
  }
  expect(outline(titled.markdown).some((section) => /prior authorization procedure code list/i.test(section.heading))).toBe(
    true,
  );

  const headingless = await pdfToMarkdown(headinglessPriorAuthCodeListPdf(), { apiKey: undefined, apiUrl: undefined });
  expect(headingless.markdown).toMatch(/\|Policy Name\|CPT Code\|/);
  expect(outline(headingless.markdown)).toEqual([
    expect.objectContaining({ id: 'preamble', heading: 'Preamble' }),
  ]);
  expect(isCodeListDocument(headingless.markdown)).toBe(true);
});

test('empty or code-dropping conversions fail instead of looking like a non-policy', () => {
  const pdf = textPdf(['Bariatric Surgery CPT 43644 and 43645 require review.']);
  expect(conversionQualityError('   \n', pdf)).toMatchObject({
    code: 'conversion_failed',
    message: /produced no text/,
  });
  expect(conversionQualityError('Cover page only.\n', pdf)).toMatchObject({
    code: 'conversion_failed',
    message: /dropped procedure codes/,
    details: { dropped_codes: expect.arrayContaining(['43644', '43645']) },
  });
  expect(conversionQualityError('Bariatric Surgery CPT 43644 and 43645 require review.\n', pdf)).toBeUndefined();
});

test('a heading-less code table is recovered when Gemini-style triage calls it a preamble', async () => {
  const sources: AgentSources = { markdown: async () => CODE_LIST_MARKDOWN, approvedExtraction: async () => null };
  const models = geminiStyleReject();
  const agent = await createPolicyAgent({ market: 'us', models: models.source, sources });
  const result = await agent.extractDocument(job);
  expect(result.triage).toMatchObject({
    is_prior_auth_policy: true,
    section_ids: ['preamble'],
  });
  expect(result.extraction).toEqual(priorAuthCodeList);
  expect(result.model).toBe('google/extract');
});

test('a true non-policy rejection reports the converted text triage saw', async () => {
  const sources: AgentSources = { markdown: async () => RETIRED_NOTICE, approvedExtraction: async () => null };
  const models = scriptedModels({
    triage: [
      () => toolCall('get_policy_document', { document_id: DOC }),
      () =>
        toolCall('save_triage', {
          document_id: DOC,
          triage: { is_prior_auth_policy: false, section_ids: [], reason: 'Retired policy notice' },
        }),
    ],
  });
  const agent = await createPolicyAgent({ market: 'us', models: models.source, sources });
  const error = await agent.extractDocument(job).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({
    code: 'not_a_policy',
    message: new RegExp(
      `after seeing ${RETIRED_NOTICE.length} characters across 1 outline sections \\[Preamble \\(${RETIRED_NOTICE.length} chars\\)\\]: Retired policy notice`,
    ),
    details: {
      document_id: DOC,
      total_chars: RETIRED_NOTICE.length,
      sections: [expect.objectContaining({ id: 'preamble', heading: 'Preamble', chars: RETIRED_NOTICE.length })],
    },
  });
});

test('recoverCodeListTriage does not override a narrative policy that triage rejected', () => {
  const markdown = ['# Coverage Rationale', 'BMI of 40.', '# Applicable Codes', '|CPT|', '|---|', '|43644|'].join('\n');
  const triage = { is_prior_auth_policy: false, section_ids: [], reason: 'Retired policy notice' };
  expect(isCodeListDocument(markdown)).toBe(false);
  expect(recoverCodeListTriage(markdown, triage)).toEqual(triage);
});

test('replay extract of a two-column code-list PDF captures CPT codes', async () => {
  const engine = await createEngine();
  engine.agents.us = await createPolicyAgent({
    market: 'us',
    models: replayModels(() => priorAuthCodeList),
    sources: { markdown: async () => '', approvedExtraction: async () => null },
  });
  const result = await extractFromPdf(engine, {
    pdf: priorAuthCodeListPdf(),
    payer: priorAuthCodeList.payer,
    title: priorAuthCodeList.title,
  });
  expect(result.converter).toBe('anydoc');
  expect(result.model).toBe('replay/extract');
  expect(result.extraction).toEqual(priorAuthCodeList);
  expect(result.sectionsRead.length).toBeGreaterThan(0);
  await closeContext(engine);
});

test('a mocked Anthropic path extracts the same two-column code-list PDF', async () => {
  const engine = await createEngine();
  engine.agents.us = await createPolicyAgent({
    market: 'us',
    models: replayModels(() => priorAuthCodeList, 'anthropic'),
    sources: { markdown: async () => '', approvedExtraction: async () => null },
  });
  const result = await extractFromPdf(engine, {
    pdf: headinglessPriorAuthCodeListPdf(),
    payer: priorAuthCodeList.payer,
    title: priorAuthCodeList.title,
  });
  expect(result.model).toBe('anthropic/extract');
  expect(result.extraction).toEqual(priorAuthCodeList);
  await closeContext(engine);
});

test('a mocked Gemini path extracts a heading-less code-list PDF after recovering preamble-only triage', async () => {
  const engine = await createEngine();
  engine.agents.us = await createPolicyAgent({
    market: 'us',
    models: geminiStyleReject().source,
    sources: { markdown: async () => '', approvedExtraction: async () => null },
  });
  const result = await extractFromPdf(engine, {
    pdf: headinglessPriorAuthCodeListPdf(),
    payer: priorAuthCodeList.payer,
    title: priorAuthCodeList.title,
  });
  expect(result.model).toBe('google/extract');
  expect(result.extraction).toEqual(priorAuthCodeList);
  await closeContext(engine);
});

async function liveExtract(llm: { strong: string; cheap: string }) {
  const engine = await createEngine({ llm });
  try {
    const result = await extractFromPdf(engine, {
      pdf: priorAuthCodeListPdf(),
      payer: priorAuthCodeList.payer,
      title: priorAuthCodeList.title,
    });
    const parsed = extractSchemas.us.parse(result.extraction);
    expect(parsed.codes.map((code) => code.code).sort()).toEqual(
      PRIOR_AUTH_CODE_LIST_ROWS.map((row) => row.code).sort(),
    );
    expect(parsed.auth_type).toBe('prior_authorization');
  } finally {
    await closeContext(engine);
  }
}

test.skipIf(!hasGoogle)('live Gemini extracts CPT codes from a two-column prior-auth table PDF', async () => {
  await liveExtract(MODEL_EXAMPLES.google);
}, 180_000);

test.skipIf(!hasAnthropic)('live Anthropic extracts CPT codes from a two-column prior-auth table PDF', async () => {
  await liveExtract(DEFAULT_MODELS);
}, 180_000);

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createPolicyAgent } from '../src/agent/policy-agent';
import { fixtureExtractions, replayModels } from '../src/agent/replay-model';
import { closeContext } from '../src/context';
import { createEngine } from '../src/engine';
import { extractFromPdf } from '../src/extract';
import * as api from '../src/publish';
import { textPdf } from '../src/testing/pdf';

const gold: unknown = JSON.parse(readFileSync('evals/fixtures/uhc.bariatric-surgery/expected.json', 'utf8'));
const fixturePdf = () =>
  textPdf([
    'UnitedHealthcare Commercial Medical Policy',
    'Bariatric Surgery',
    'Coverage Rationale',
    'BMI of 40 or greater.',
    'Applicable Codes',
    'CPT 43644 laparoscopic gastric bypass',
  ]);

test('createEngine works without a database', async () => {
  const engine = await createEngine();
  expect(engine.db).toBeUndefined();
  expect(engine.config.databaseUrl).toBeUndefined();
  expect(engine.config.storage).toEqual({ kind: 'local', dataDir: './data/policies' });
  await closeContext(engine);
});

test('the published createEngine works without arguments', async () => {
  const engine = await api.createEngine();
  expect(engine.db).toBeUndefined();
  expect(engine.config.databaseUrl).toBeUndefined();
  await api.closeContext(engine);
});

test('catalog methods fail clearly without a database', async () => {
  const engine = await createEngine();
  await expect(api.registerPayer(engine, { name: 'UnitedHealthcare', slug: 'uhc', market: 'us' })).rejects.toMatchObject({
    code: 'database_not_configured',
    message: /Pass databaseUrl or db to createEngine/,
  });
  await expect(api.listPayers(engine, { limit: 1 })).rejects.toMatchObject({ code: 'database_not_configured' });
  await closeContext(engine);
});

test('extract returns structured rules from a fixture policy PDF without a database', async () => {
  const engine = await createEngine();
  engine.agents.us = await createPolicyAgent({
    market: 'us',
    models: replayModels(fixtureExtractions('evals/fixtures', 'expected.json')),
    sources: { markdown: async () => '', approvedExtraction: async () => null },
  });
  const result = await extractFromPdf(engine, {
    pdf: fixturePdf(),
    payer: 'UnitedHealthcare',
    title: 'Bariatric Surgery',
  });
  expect(result.extraction).toEqual(gold);
  expect(result.converter).toBe('anydoc');
  expect(result.model).toBe('replay/extract');
  expect(engine.db).toBeUndefined();
  await closeContext(engine);
});

test('the published extract function is the public API', async () => {
  const engine = await createEngine();
  engine.agents.us = await createPolicyAgent({
    market: 'us',
    models: replayModels(fixtureExtractions('evals/fixtures', 'expected.json')),
    sources: { markdown: async () => '', approvedExtraction: async () => null },
  });
  const result = await api.extract(engine, {
    pdf: fixturePdf(),
    payer: 'UnitedHealthcare',
    title: 'Bariatric Surgery',
  });
  expect(result.extraction).toEqual(gold);
  await closeContext(engine);
});

test('extract rejects a non-PDF without touching a database', async () => {
  const engine = await createEngine();
  await expect(api.extract(engine, { pdf: new Uint8Array([1, 2, 3, 4, 5]) })).rejects.toMatchObject({ code: 'not_a_pdf' });
  await closeContext(engine);
});

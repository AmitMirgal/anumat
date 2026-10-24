import { getProviderConfig, parseModelString } from '@mastra/core/llm';
import { describe, expect, test } from 'vitest';
import { createPolicyAgent } from '../src/agent/policy-agent';
import type { AgentSources } from '../src/agent/tools';
import { DEFAULT_MODELS, loadConfig, MODEL_EXAMPLES } from '../src/config';

const sources: AgentSources = { markdown: async () => '', approvedExtraction: async () => null };
const job = {
  documentId: '6f1c1c52-0c1e-4a36-9d6a-3d8f6f0b9a11',
  policyKey: 'uhc.bariatric-surgery',
  payer: 'UnitedHealthcare',
  title: 'Bariatric Surgery',
};
const baseEnv = {
  DATABASE_URL: 'postgres://anumat:anumat@127.0.0.1:5432/anumat',
  ANUMAT_API_KEYS: 'dev:replace-with-a-random-string-of-16-or-more-characters',
};
const OPENAI = { strong: 'openai/gpt-4.1', cheap: 'openai/gpt-4.1-mini' } as const;
const PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'XAI_API_KEY',
] as const;

async function withProviderEnv(
  patch: Partial<Record<(typeof PROVIDER_KEYS)[number], string>>,
  run: () => Promise<void>,
): Promise<void> {
  const saved = PROVIDER_KEYS.map((name) => [name, process.env[name]] as const);
  for (const name of PROVIDER_KEYS) delete process.env[name];
  for (const [name, value] of Object.entries(patch)) process.env[name] = value;
  try {
    await run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function registeredEnv(model: string): string {
  const { provider, modelId } = parseModelString(model);
  const config = provider ? getProviderConfig(provider) : undefined;
  expect(config, provider ?? model).toBeDefined();
  expect(config?.models).toContain(modelId);
  const env = config?.apiKeyEnvVar;
  const names = Array.isArray(env) ? env : env ? [env] : [];
  expect(names.length).toBeGreaterThan(0);
  return names.join(' or ');
}

describe.sequential('model router providers', () => {
  test('cheap and strong accept Google and Grok router ids and keep Anthropic defaults', () => {
    expect(loadConfig(baseEnv).models).toEqual(DEFAULT_MODELS);
    expect(
      loadConfig({
        ...baseEnv,
        ANUMAT_STRONG_MODEL: MODEL_EXAMPLES.google.strong,
        ANUMAT_CHEAP_MODEL: MODEL_EXAMPLES.google.cheap,
      }).models,
    ).toEqual(MODEL_EXAMPLES.google);
    expect(
      loadConfig({
        ...baseEnv,
        ANUMAT_STRONG_MODEL: MODEL_EXAMPLES.grok.strong,
        ANUMAT_CHEAP_MODEL: MODEL_EXAMPLES.grok.cheap,
      }).models,
    ).toEqual(MODEL_EXAMPLES.grok);
    expect(
      loadConfig({ ...baseEnv, ANUMAT_CHEAP_MODEL: 'serum/example-model', ANUMAT_STRONG_MODEL: 'serum/example-model' }).models,
    ).toEqual({ cheap: 'serum/example-model', strong: 'serum/example-model' });
    expect(() => loadConfig({ ...baseEnv, ANUMAT_CHEAP_MODEL: 'claude-haiku-4-5' })).toThrow(/provider\/model/);
  });

  test('missing credentials are reported for the configured provider', async () => {
    await withProviderEnv({ ANTHROPIC_API_KEY: 'anthropic-key-present' }, async () => {
      for (const example of [MODEL_EXAMPLES.google, MODEL_EXAMPLES.grok, OPENAI]) {
        const cheapEnv = registeredEnv(example.cheap);
        const strongEnv = registeredEnv(example.strong);
        const agent = await createPolicyAgent({
          market: 'us',
          models: { kind: 'router', strong: example.strong, cheap: example.cheap },
          sources,
        });
        expect(await agent.modelStatus('triage')).toEqual({ model: example.cheap, hasAuth: false, envVar: cheapEnv });
        expect(await agent.modelStatus('extract')).toEqual({ model: example.strong, hasAuth: false, envVar: strongEnv });
        await expect(agent.extractDocument(job)).rejects.toMatchObject({
          code: 'llm_not_configured',
          details: { mode: 'triage', model: example.cheap, env_var: cheapEnv },
        });
        expect(cheapEnv).not.toContain('ANTHROPIC_API_KEY');
      }
    });
  });

  test('a Google or Grok key is enough when Anthropic is unset', async () => {
    await withProviderEnv({ GOOGLE_API_KEY: 'google-key-present' }, async () => {
      const agent = await createPolicyAgent({ market: 'us', models: { kind: 'router', ...MODEL_EXAMPLES.google }, sources });
      expect(await agent.modelStatus('triage')).toEqual({ model: MODEL_EXAMPLES.google.cheap, hasAuth: true, envVar: undefined });
      expect(await agent.modelStatus('review')).toEqual({ model: MODEL_EXAMPLES.google.strong, hasAuth: true, envVar: undefined });
    });
    await withProviderEnv({ GOOGLE_GENERATIVE_AI_API_KEY: 'google-genai-key-present' }, async () => {
      const agent = await createPolicyAgent({ market: 'us', models: { kind: 'router', ...MODEL_EXAMPLES.google }, sources });
      expect(await agent.modelStatus('extract')).toEqual({ model: MODEL_EXAMPLES.google.strong, hasAuth: true, envVar: undefined });
    });
    await withProviderEnv({ OPENAI_API_KEY: 'openai-key-present' }, async () => {
      const agent = await createPolicyAgent({ market: 'us', models: { kind: 'router', ...OPENAI }, sources });
      expect(await agent.modelStatus('triage')).toEqual({ model: OPENAI.cheap, hasAuth: true, envVar: undefined });
    });
    await withProviderEnv({ XAI_API_KEY: 'xai-key-present' }, async () => {
      const agent = await createPolicyAgent({ market: 'us', models: { kind: 'router', ...MODEL_EXAMPLES.grok }, sources });
      expect(await agent.modelStatus('triage')).toEqual({ model: MODEL_EXAMPLES.grok.cheap, hasAuth: true, envVar: undefined });
      expect(await agent.modelStatus('extract')).toEqual({ model: MODEL_EXAMPLES.grok.strong, hasAuth: true, envVar: undefined });
    });
  });

  test('serum is not a router provider, so no key is invented for serum/<model>', async () => {
    const model = 'serum/example-model';
    expect(getProviderConfig('serum')).toBeUndefined();
    await withProviderEnv({ ANTHROPIC_API_KEY: 'anthropic-key-present' }, async () => {
      const agent = await createPolicyAgent({ market: 'us', models: { kind: 'router', strong: model, cheap: model }, sources });
      expect(await agent.modelStatus('triage')).toEqual({ model, hasAuth: false, envVar: undefined });
    });
  });
});

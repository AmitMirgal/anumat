import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { createPolicyAgent, type ModelSource } from '../src/agent/policy-agent';
import { loadConfig } from '../src/config';
import { closeContext, createContext, modelSource } from '../src/context';
import { createApp } from '../src/http/app';

const UHC_BARIATRIC =
  'https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/bariatric-surgery.pdf';

const config = loadConfig();
const live: ModelSource = { kind: 'router', ...config.models };
const probe = await createPolicyAgent({
  market: 'us',
  models: live,
  sources: { markdown: async () => '', approvedExtraction: async () => null },
});
const missing = (await Promise.all([probe.modelStatus('triage'), probe.modelStatus('extract')])).filter((s) => !s.hasAuth);
const replay = config.llmMode === 'replay' || missing.length > 0;

console.log('Anumat end-to-end demo');
if (replay) {
  const reason = missing.length
    ? `No API key for ${missing.map((s) => `${s.model} (${s.envVar ?? 'provider key'})`).join(' and ')}.`
    : 'ANUMAT_LLM_MODE=replay is set.';
  console.log(`LLM: ${reason} Using the replay model.`);
  console.log('The live PDF is still fetched and converted, and triage and extract still run through the agent tools.');
  console.log('The saved extraction is the golden fixture evals/fixtures/uhc.bariatric-surgery/expected.json, not a model reading of the PDF.');
} else {
  console.log(`LLM: live. Triage uses ${config.models.cheap}; extract uses ${config.models.strong}. The check can take a minute.`);
}

const ctx = await createContext(config, { models: replay ? modelSource({ ...config, llmMode: 'replay' }) : live });
const server = serve({ fetch: createApp(ctx).fetch, hostname: '127.0.0.1', port: 0 });
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('The demo server did not bind a TCP port');
const base = `http://127.0.0.1:${address.port}`;
const apiKey = config.apiKeys[0]?.key ?? '';

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: JSON.parse(await response.text()) };
}

function expectThat(condition: boolean, message: string, detail: unknown): asserts condition {
  if (!condition) throw new Error(`${message}\n${JSON.stringify(detail, null, 2)}`);
}

try {
  const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);

  const payer = await api('POST', '/v1/payers', { name: 'UnitedHealthcare', slug: `demo-uhc-${runId}`, market: 'us' });
  expectThat(payer.status === 201, 'Payer registration failed', payer);
  console.log(`\n1. Registered payer ${payer.body.slug} (market ${payer.body.market}).`);

  const source = await api('POST', '/v1/sources', {
    payer_id: payer.body.id,
    title: 'Bariatric Surgery',
    policy_slug: 'bariatric-surgery',
    source_url: `${UHC_BARIATRIC}?anumat-demo=${runId}`,
  });
  expectThat(source.status === 201, 'Source registration failed', source);
  const policyKey: string = source.body.policy_key;
  console.log(`2. Registered source ${policyKey} for the live UHC Bariatric Surgery PDF.`);

  const check = await api('POST', `/v1/sources/${source.body.id}/check`);
  const run = check.body.watch_run;
  expectThat(run.outcome === 'new_artifact' && check.body.version, 'The first check did not propose a version', check.body);
  console.log(`3. Check: outcome ${run.outcome}. Version ${check.body.version.id} is ${check.body.version.status}, extracted by ${check.body.version.extracted_by}.`);

  const unpublished = await api('GET', `/v1/policies/${policyKey}`);
  expectThat(unpublished.status === 404, 'The proposal was visible before approval', unpublished);
  console.log(`4. GET /v1/policies/${policyKey} before approval: ${unpublished.status} ${unpublished.body.error.code}.`);

  const diff = await api('GET', `/v1/diffs/${check.body.diff.id}`);
  const counts = Object.entries(
    Object.groupBy(diff.body.changes as { field: string; kind: string }[], (c) => `${c.field} ${c.kind}`),
  ).map(([label, changes]) => `${changes?.length ?? 0} ${label}`);
  console.log(`5. Diff against the previous approved version (none yet): ${counts.join(', ')}.`);

  const approved = await api('POST', `/v1/versions/${check.body.version.id}/approve`);
  expectThat(approved.status === 200, 'Approval failed', approved);
  console.log(`6. Approved by ${approved.body.approved_by}. Published as version ${approved.body.version}.`);

  const published = await api('GET', `/v1/policies/${policyKey}`);
  expectThat(published.status === 200 && published.body.version === 1, 'The approved version was not served', published);
  const rules = published.body.rules;
  console.log(
    `7. GET /v1/policies/${policyKey}: version ${published.body.version}, ${rules.codes.length} codes, ${rules.indications.length} indications, effective ${rules.effective_date}.`,
  );
  console.log(`   First criterion: ${rules.indications[0]?.criteria[0]?.text}`);

  const recheck = await api('POST', `/v1/sources/${source.body.id}/check`);
  expectThat(
    recheck.body.watch_run.outcome === 'unchanged' && recheck.body.version.id === check.body.version.id,
    'The second check did not skip the unchanged PDF',
    recheck.body,
  );
  console.log('8. Second check: outcome unchanged. Same SHA-256, so no new version.');
  console.log('\nDemo complete.');
} finally {
  server.close();
  await closeContext(ctx);
}

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelSource } from '../../src/agent/policy-agent';
import { loadConfig } from '../../src/config';
import { closeContext, createContext } from '../../src/context';
import type { SourceAdapter } from '../../src/sources/adapters';
import { TEST_DATABASE_URL, testDb } from './db';
import { textPdf } from './pdf';

export const TEST_API_KEY = 'test-key-0123456789abcdef';

export function fakePayerSite(lines: string[]) {
  let bytes = textPdf(lines);
  const adapter: SourceAdapter = { fetchArtifact: async () => ({ bytes, mime: 'application/pdf' }) };
  return {
    adapter,
    publish: (next: string[]) => {
      bytes = textPdf(next);
    },
  };
}

export async function testContext(options: { models: ModelSource; adapter: SourceAdapter }) {
  const t = await testDb();
  const config = loadConfig({
    DATABASE_URL: TEST_DATABASE_URL,
    ANUMAT_API_KEYS: `tester:${TEST_API_KEY}`,
    ANUMAT_DATA_DIR: await mkdtemp(join(tmpdir(), 'anumat-data-')),
    RATE_LIMIT_PER_MINUTE: '1000',
  });
  const ctx = await createContext(config, { models: options.models, adapters: { http_pdf: options.adapter } });
  return {
    ctx,
    reset: t.reset,
    counts: async () => {
      const [row] = await t.sql`select
        (select count(*) from policy_artifacts)::int as artifacts,
        (select count(*) from policy_documents)::int as documents,
        (select count(*) from policy_versions)::int as versions,
        (select count(*) from watch_runs)::int as runs`;
      return row;
    },
    close: async () => {
      await closeContext(ctx);
      await t.close();
    },
  };
}

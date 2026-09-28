import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createPolicyAgent } from '../src/agent/policy-agent';
import { replayModels } from '../src/agent/replay-model';
import { outline } from '../src/documents/outline';
import { extractSchemas } from '../src/markets/registry';

const MARKDOWN_DIR = 'data/policies/markdown';
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : existsSync(MARKDOWN_DIR)
    ? readdirSync(MARKDOWN_DIR).map((file) => join(MARKDOWN_DIR, file))
    : [];
if (files.length === 0) {
  console.log(`No markdown found. Run pnpm db:seed and pnpm watch first, or pass markdown file paths.`);
  process.exit(1);
}

const extraction: unknown = JSON.parse(readFileSync('evals/fixtures/uhc.bariatric-surgery/expected.json', 'utf8'));
const rows = [];
for (const file of files) {
  const markdown = readFileSync(file, 'utf8');
  const agent = await createPolicyAgent({
    market: 'us',
    models: replayModels(() => extraction),
    sources: { markdown: async () => markdown, approvedExtraction: async () => null },
  });
  const result = await agent.extractDocument({
    documentId: '00000000-0000-4000-8000-000000000002',
    policyKey: 'report.policy',
    payer: 'Report',
    title: 'Policy',
  });
  const title = markdown.match(/^#{1,2} (.+)$/m)?.[1] ?? file;
  rows.push({
    document: title.slice(0, 48),
    document_chars: markdown.length,
    headings: outline(markdown).length,
    sections_read: result.sectionsRead.join(', '),
    chars_to_model: result.charsRead,
    share: `${((100 * result.charsRead) / markdown.length).toFixed(1)}%`,
  });
}
console.table(rows);
console.log(`save_extraction input schema: ${JSON.stringify(z.toJSONSchema(extractSchemas.us)).length} chars of JSON Schema per extract call.`);

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { extractSchemas } from '@anumat/markets';

const root = 'evals/fixtures';
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const cases = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(`${root}/${entry.name}/expected.json`))
  .map((entry) => entry.name)
  .sort();
const schemaIssues = (value: unknown) =>
  extractSchemas.us.safeParse(value).error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) ?? [];

test('golden cases cover UHC and Cigna policies', () => {
  expect(cases).toEqual(['cigna.bariatric-surgery', 'uhc.bariatric-surgery', 'uhc.obstructive-sleep-apnea-treatment']);
});

test.each(cases)('%s gold and candidate pass the US schema and differ', (name) => {
  const expected = readJson(`${root}/${name}/expected.json`);
  const candidate = readJson(`${root}/${name}/candidate.json`);
  expect(schemaIssues(expected)).toEqual([]);
  expect(schemaIssues(candidate)).toEqual([]);
  expect(candidate).not.toEqual(expected);
  expect(readFileSync(`${root}/${name}/document.md`, 'utf8')).toMatch(/^#{1,6} /m);
});

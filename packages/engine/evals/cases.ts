import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const FIXTURES = 'evals/fixtures';
const DIFF_FIXTURES = join(FIXTURES, 'diffs');
const CaseMeta = z.object({ policy_key: z.string(), title: z.string(), payer: z.string() });
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const dirsWith = (root: string, file: string) =>
  readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, file)))
    .map((entry) => entry.name)
    .sort();

export type ExtractionCase = {
  id: string;
  policyKey: string;
  payer: string;
  title: string;
  document: string;
  expected: unknown;
  candidate: unknown;
};

export function extractionCases(): ExtractionCase[] {
  return dirsWith(FIXTURES, 'expected.json').map((id) => {
    const dir = join(FIXTURES, id);
    const meta = CaseMeta.parse(readJson(join(dir, 'case.json')));
    return {
      id,
      policyKey: meta.policy_key,
      payer: meta.payer,
      title: meta.title,
      document: readFileSync(join(dir, 'document.md'), 'utf8'),
      expected: readJson(join(dir, 'expected.json')),
      candidate: readJson(join(dir, 'candidate.json')),
    };
  });
}

export function diffCases() {
  return dirsWith(DIFF_FIXTURES, 'expected-changes.json').map((id) => {
    const dir = join(DIFF_FIXTURES, id);
    return {
      id,
      previous: readJson(join(dir, 'previous.json')),
      current: readJson(join(dir, 'current.json')),
      expected: readJson(join(dir, 'expected-changes.json')),
    };
  });
}

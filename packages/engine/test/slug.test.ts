import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { slugify } from '../src/publish';

const vectors = JSON.parse(readFileSync(new URL('../slug-vectors.json', import.meta.url), 'utf8')) as {
  input: string;
  slug: string;
}[];

test('the published slugify matches the shared vectors', () => {
  for (const vector of vectors) expect(slugify(vector.input), vector.input).toBe(vector.slug);
});

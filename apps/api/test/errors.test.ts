import { expect, test } from 'vitest';
import { createApp } from '../src/http/app';

test('an API error body does not include a stack trace', async () => {
  const app = createApp();
  const response = await app.request('/api/v1/payers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Example', slug: 'example', market: 'us' }),
  });
  const text = await response.text();
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(text).not.toContain('"stack"');
  expect(text).not.toContain('at ');
});

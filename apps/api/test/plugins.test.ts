import { expect, test } from 'vitest';
import { createApp } from '../src/http/app';

test('createApp() answers /health with no plug-ins and no database', async () => {
  const app = createApp();
  const response = await app.request('/health');
  expect({ status: response.status, body: await response.json() }).toEqual({
    status: 200,
    body: { status: 'ok' },
  });
});

import { expect, test } from 'vitest';
import { AnumatClientError, createAnumatClient } from '@anumat/js';

test('createAnumatClient rejects a base URL that is not http(s)', () => {
  expect(() => createAnumatClient({ baseUrl: 'ftp://example.test', apiKey: 'test-key' })).toThrow(AnumatClientError);
  expect(() => createAnumatClient({ baseUrl: 'not a url', apiKey: 'test-key' })).toThrow(/http\(s\) URL/);
});

test('createAnumatClient rejects an empty api key', () => {
  expect(() => createAnumatClient({ baseUrl: 'http://127.0.0.1:4471', apiKey: '   ' })).toThrow(/apiKey/);
});

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadConfig } from '../src/config';
import { createBlobStore } from '../src/storage/blob-store';

const baseEnv = {
  DATABASE_URL: 'postgres://anumat:anumat@127.0.0.1:5432/anumat',
  ANUMAT_API_KEYS: 'dev:replace-with-a-random-string-of-16-or-more-characters',
};

test('a local store round-trips an object', async () => {
  const store = createBlobStore({ kind: 'local', dataDir: await mkdtemp(join(tmpdir(), 'anumat-blobs-')) });
  const key = 'pdf/abc.pdf';
  const first = new Uint8Array([1, 2, 3]);
  expect(await store.put(key, first)).toBe(key);
  expect(await store.get(key)).toEqual(first);
  const second = new Uint8Array([4, 5]);
  expect(await store.put(key, second)).toBe(key);
  expect(await store.get(key)).toEqual(second);
});

test('S3 settings parse for a Supabase endpoint and a GCS endpoint', () => {
  expect(
    loadConfig({
      ...baseEnv,
      ANUMAT_STORAGE: 's3',
      ANUMAT_S3_ENDPOINT: 'https://abcdefghijklmnop.supabase.co/storage/v1/s3',
      ANUMAT_S3_REGION: 'us-east-1',
      ANUMAT_S3_BUCKET: 'policies',
      ANUMAT_S3_ACCESS_KEY_ID: 'supabase-access-key',
      ANUMAT_S3_SECRET_ACCESS_KEY: 'supabase-secret-key',
    }).storage,
  ).toEqual({
    kind: 's3',
    endpoint: 'https://abcdefghijklmnop.supabase.co/storage/v1/s3',
    region: 'us-east-1',
    bucket: 'policies',
    accessKeyId: 'supabase-access-key',
    secretAccessKey: 'supabase-secret-key',
  });

  expect(
    loadConfig({
      ...baseEnv,
      ANUMAT_STORAGE: 's3',
      ANUMAT_S3_ENDPOINT: 'https://storage.googleapis.com',
      ANUMAT_S3_REGION: 'auto',
      ANUMAT_S3_BUCKET: 'anumat-policies',
      ANUMAT_S3_ACCESS_KEY_ID: 'gcs-hmac-access-id',
      ANUMAT_S3_SECRET_ACCESS_KEY: 'gcs-hmac-secret',
    }).storage,
  ).toEqual({
    kind: 's3',
    endpoint: 'https://storage.googleapis.com',
    region: 'auto',
    bucket: 'anumat-policies',
    accessKeyId: 'gcs-hmac-access-id',
    secretAccessKey: 'gcs-hmac-secret',
  });
});

test('local storage is the default and s3 settings are required only for s3', () => {
  expect(loadConfig(baseEnv).storage).toEqual({ kind: 'local', dataDir: './data/policies' });
  expect(() =>
    loadConfig({
      ...baseEnv,
      ANUMAT_STORAGE: 's3',
      ANUMAT_S3_ENDPOINT: 'https://abcdefghijklmnop.supabase.co/storage/v1/s3',
      ANUMAT_S3_REGION: 'us-east-1',
    }),
  ).toThrow(/ANUMAT_S3_BUCKET/);
});

import { expect, test, vi } from 'vitest';
import { createBlobStore } from '../src/storage/blob-store';
import { importStorageSdk } from '../src/storage/load-sdk';

const s3Objects = new Map<string, Uint8Array>();
const gcsObjects = new Map<string, Uint8Array>();
const supabaseObjects = new Map<string, Uint8Array>();

vi.mock('@aws-sdk/client-s3', () => {
  class PutObjectCommand {
    constructor(readonly input: { Bucket: string; Key: string; Body: Uint8Array }) {}
  }
  class GetObjectCommand {
    constructor(readonly input: { Bucket: string; Key: string }) {}
  }
  class S3Client {
    async send(command: PutObjectCommand | GetObjectCommand) {
      const key = `${command.input.Bucket}/${command.input.Key}`;
      if ('Body' in command.input) {
        s3Objects.set(key, command.input.Body);
        return {};
      }
      const body = s3Objects.get(key);
      if (!body) throw new Error(`missing ${key}`);
      return { Body: { transformToByteArray: async () => body } };
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand };
});

vi.mock('@google-cloud/storage', () => {
  class File {
    constructor(private readonly name: string) {}
    async save(data: Uint8Array) {
      gcsObjects.set(this.name, data);
    }
    async download(): Promise<[Uint8Array]> {
      const data = gcsObjects.get(this.name);
      if (!data) throw new Error(`missing ${this.name}`);
      return [data];
    }
  }
  class Bucket {
    file(name: string) {
      return new File(name);
    }
  }
  class Storage {
    bucket() {
      return new Bucket();
    }
  }
  return { Storage };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Uint8Array) => {
          supabaseObjects.set(`${bucket}/${path}`, body);
          return { error: null };
        },
        download: async (path: string) => {
          const data = supabaseObjects.get(`${bucket}/${path}`);
          if (!data) return { data: null, error: { message: 'not found' } };
          return { data: { arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) }, error: null };
        },
      }),
    },
  }),
}));

test('an S3 store round-trips through the AWS SDK', async () => {
  const store = createBlobStore({
    kind: 's3',
    region: 'us-east-1',
    bucket: 'policies',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    endpoint: undefined,
  });
  const bytes = new Uint8Array([9, 8, 7]);
  expect(await store.put('pdf/a.pdf', bytes)).toBe('pdf/a.pdf');
  expect(await store.get('pdf/a.pdf')).toEqual(bytes);
});

test('a GCS store round-trips through the Google Cloud SDK', async () => {
  const store = createBlobStore({ kind: 'gcs', bucket: 'anumat-policies', projectId: 'proj', keyFilename: undefined });
  const bytes = new Uint8Array([3, 2, 1]);
  expect(await store.put('pdf/b.pdf', bytes)).toBe('pdf/b.pdf');
  expect(await store.get('pdf/b.pdf')).toEqual(bytes);
});

test('a Supabase store round-trips through the Supabase SDK', async () => {
  const store = createBlobStore({
    kind: 'supabase',
    url: 'https://example.supabase.co',
    apiKey: 'service-role',
    bucket: 'policies',
  });
  const bytes = new Uint8Array([4, 5, 6]);
  expect(await store.put('pdf/c.pdf', bytes)).toBe('pdf/c.pdf');
  expect(await store.get('pdf/c.pdf')).toEqual(bytes);
});

test('a missing cloud SDK names the package to install', async () => {
  await expect(importStorageSdk('anumat-not-a-storage-sdk', 'gcs')).rejects.toMatchObject({
    code: 'storage_not_configured',
    message: 'Install anumat-not-a-storage-sdk to use storage kind gcs.',
  });
});

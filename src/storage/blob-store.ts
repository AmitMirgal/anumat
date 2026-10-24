import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { S3Storage, StorageConfig } from '../config';

export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<string>;
  get(key: string): Promise<Uint8Array>;
}

export function createBlobStore(storage: StorageConfig): BlobStore {
  switch (storage.kind) {
    case 'local':
      return new LocalBlobStore(storage.dataDir);
    case 's3':
      return new S3CompatibleStore(storage);
    default: {
      const unreachable: never = storage;
      return unreachable;
    }
  }
}

class LocalBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  async put(key: string, bytes: Uint8Array): Promise<string> {
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, bytes);
    await rename(temp, path);
    return key;
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(join(this.root, key)));
  }
}

class S3CompatibleStore implements BlobStore {
  private readonly client: S3Client;

  constructor(private readonly settings: S3Storage) {
    this.client = new S3Client({
      region: settings.region,
      endpoint: settings.endpoint,
      forcePathStyle: settings.endpoint !== undefined,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(key: string, bytes: Uint8Array): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.settings.bucket,
        Key: key,
        Body: bytes,
      }),
    );
    return key;
  }

  async get(key: string): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.settings.bucket,
        Key: key,
      }),
    );
    const body = response.Body;
    if (!body) throw new Error(`Object ${key} has no body`);
    return body.transformToByteArray();
  }
}

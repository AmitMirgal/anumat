import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Config } from '../config';
import { AppError } from '../errors';

export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<string>;
  get(key: string): Promise<Uint8Array>;
}

export class LocalBlobStore implements BlobStore {
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

export class S3BlobStore implements BlobStore {
  async put(): Promise<string> {
    throw notConfigured();
  }

  async get(): Promise<Uint8Array> {
    throw notConfigured();
  }
}

const notConfigured = () =>
  new AppError('storage_not_configured', 'S3 storage is a stub. Set ANUMAT_STORAGE=local or implement S3BlobStore.');

export function createBlobStore(config: Pick<Config, 'storage' | 'dataDir'>): BlobStore {
  return config.storage === 's3' ? new S3BlobStore() : new LocalBlobStore(config.dataDir);
}

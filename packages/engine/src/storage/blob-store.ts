import type { StorageConfig } from '../config';
import { GcsBlobStore } from './gcs';
import { LocalBlobStore } from './local';
import { S3CompatibleStore } from './s3';
import { SupabaseBlobStore } from './supabase';

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
    case 'gcs':
      return new GcsBlobStore(storage);
    case 'supabase':
      return new SupabaseBlobStore(storage);
    default: {
      const unreachable: never = storage;
      return unreachable;
    }
  }
}

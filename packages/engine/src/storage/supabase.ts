import { AppError } from '@anumat/core';
import type { SupabaseStorage } from '../config';
import { importStorageSdk } from './load-sdk';

type SupabaseBucket = {
  upload(
    path: string,
    body: Buffer | Uint8Array,
    options?: { upsert?: boolean; contentType?: string },
  ): Promise<{ error: { message: string } | null }>;
  download(path: string): Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: { message: string } | null }>;
};

type SupabaseSdk = {
  createClient: (
    url: string,
    key: string,
  ) => {
    storage: { from(bucket: string): SupabaseBucket };
  };
};

export class SupabaseBlobStore {
  private bucketPromise: Promise<SupabaseBucket> | undefined;

  constructor(private readonly settings: SupabaseStorage) {}

  private async bucket(): Promise<SupabaseBucket> {
    if (!this.bucketPromise) {
      this.bucketPromise = importStorageSdk<SupabaseSdk>('@supabase/supabase-js', 'supabase').then((sdk) =>
        sdk.createClient(this.settings.url, this.settings.apiKey).storage.from(this.settings.bucket),
      );
    }
    return this.bucketPromise;
  }

  async put(key: string, bytes: Uint8Array): Promise<string> {
    const { error } = await (await this.bucket()).upload(key, bytes, {
      upsert: true,
      contentType: 'application/octet-stream',
    });
    if (error) throw new AppError('internal', `Supabase Storage upload failed: ${error.message}`, { key });
    return key;
  }

  async get(key: string): Promise<Uint8Array> {
    const { data, error } = await (await this.bucket()).download(key);
    if (error || !data) throw new AppError('internal', `Supabase Storage download failed: ${error?.message ?? 'no data'}`, { key });
    return new Uint8Array(await data.arrayBuffer());
  }
}

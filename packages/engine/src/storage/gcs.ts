import type { GcsStorage } from '../config';
import { importStorageSdk } from './load-sdk';

type GcsFile = {
  save(data: Buffer | Uint8Array, options?: { resumable?: boolean }): Promise<unknown>;
  download(): Promise<[Buffer | Uint8Array]>;
};

type GcsSdk = {
  Storage: new (options?: { projectId?: string; keyFilename?: string }) => {
    bucket(name: string): { file(name: string): GcsFile };
  };
};

export class GcsBlobStore {
  private storagePromise: Promise<InstanceType<GcsSdk['Storage']>> | undefined;

  constructor(private readonly settings: GcsStorage) {}

  private async storage(): Promise<InstanceType<GcsSdk['Storage']>> {
    if (!this.storagePromise) {
      this.storagePromise = importStorageSdk<GcsSdk>('@google-cloud/storage', 'gcs').then(
        (sdk) =>
          new sdk.Storage({
            projectId: this.settings.projectId,
            keyFilename: this.settings.keyFilename,
          }),
      );
    }
    return this.storagePromise;
  }

  async put(key: string, bytes: Uint8Array): Promise<string> {
    await (await this.storage()).bucket(this.settings.bucket).file(key).save(bytes, { resumable: false });
    return key;
  }

  async get(key: string): Promise<Uint8Array> {
    const [data] = await (await this.storage()).bucket(this.settings.bucket).file(key).download();
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }
}

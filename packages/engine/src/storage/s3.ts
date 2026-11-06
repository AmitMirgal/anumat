import type { S3Storage } from '../config';
import { importStorageSdk } from './load-sdk';

type S3Sdk = typeof import('@aws-sdk/client-s3');

export class S3CompatibleStore {
  private clientPromise: Promise<InstanceType<S3Sdk['S3Client']>> | undefined;
  private sdk: S3Sdk | undefined;

  constructor(private readonly settings: S3Storage) {}

  private async load(): Promise<S3Sdk> {
    if (!this.sdk) this.sdk = await importStorageSdk<S3Sdk>('@aws-sdk/client-s3', 's3');
    return this.sdk;
  }

  private async client(): Promise<InstanceType<S3Sdk['S3Client']>> {
    if (!this.clientPromise) {
      this.clientPromise = this.load().then(
        (sdk) =>
          new sdk.S3Client({
            region: this.settings.region,
            endpoint: this.settings.endpoint,
            forcePathStyle: this.settings.endpoint !== undefined,
            credentials: {
              accessKeyId: this.settings.accessKeyId,
              secretAccessKey: this.settings.secretAccessKey,
            },
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
          }),
      );
    }
    return this.clientPromise;
  }

  async put(key: string, bytes: Uint8Array): Promise<string> {
    const sdk = await this.load();
    await (await this.client()).send(
      new sdk.PutObjectCommand({
        Bucket: this.settings.bucket,
        Key: key,
        Body: bytes,
      }),
    );
    return key;
  }

  async get(key: string): Promise<Uint8Array> {
    const sdk = await this.load();
    const response = await (await this.client()).send(
      new sdk.GetObjectCommand({
        Bucket: this.settings.bucket,
        Key: key,
      }),
    );
    const body = response.Body;
    if (!body) throw new Error(`Object ${key} has no body`);
    return body.transformToByteArray();
  }
}

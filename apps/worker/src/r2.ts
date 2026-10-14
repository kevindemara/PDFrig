import { AwsClient } from 'aws4fetch';

export interface WorkerR2Config {
  readonly accessKeyId: string;
  readonly accountId: string;
  readonly bucket: string;
  readonly secretAccessKey: string;
}

const encodeObjectKey = (value: string): string =>
  value
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

export class WorkerPrivateObjectStore {
  readonly #aws: AwsClient;
  readonly #baseUrl: string;
  readonly #bucket: string;

  public constructor(config: WorkerR2Config) {
    this.#aws = new AwsClient({
      accessKeyId: config.accessKeyId,
      region: 'auto',
      secretAccessKey: config.secretAccessKey,
      service: 's3',
    });
    this.#baseUrl = `https://${config.accountId}.r2.cloudflarestorage.com`;
    this.#bucket = config.bucket;
  }

  public async deleteAndConfirm(objectKey: string): Promise<boolean> {
    const url = this.#objectUrl(objectKey);
    const deleted = await this.#aws.fetch(url, { method: 'DELETE' });
    if (!deleted.ok && deleted.status !== 404) return false;
    const confirmation = await this.#aws.fetch(url, { method: 'HEAD' });
    return confirmation.status === 404;
  }

  #objectUrl(objectKey: string): URL {
    if (objectKey.length < 24 || objectKey.includes('..') || objectKey.startsWith('/')) {
      throw new Error('R2_OBJECT_KEY_INVALID');
    }
    return new URL(
      `${this.#baseUrl}/${encodeURIComponent(this.#bucket)}/${encodeObjectKey(objectKey)}`,
    );
  }
}

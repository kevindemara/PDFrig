import { AwsClient } from 'aws4fetch';

import type {
  PrivateObjectGrant,
  PrivateObjectHead,
  PrivateObjectStorage,
} from '@pdfmason/contracts';

export interface R2PrivateObjectStorageConfig {
  readonly accessKeyId: string;
  readonly accountId: string;
  readonly bucket: string;
  readonly secretAccessKey: string;
}

const encodeObjectKey = (objectKey: string): string =>
  objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const safeDownloadName = (value: string): string => {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return sanitized.length > 0 ? sanitized : 'pdfmason-output.pdf';
};

export const createOpaqueStorageKey = (input: {
  readonly environment: string;
  readonly jobId: string;
  readonly objectId: string;
  readonly role: 'input' | 'output' | 'preview' | 'temporary';
  readonly workspaceId: string;
}): string =>
  [input.environment, input.workspaceId, input.jobId, input.role, input.objectId]
    .map((value) => value.replace(/[^A-Za-z0-9_-]/g, ''))
    .join('/');

export class R2PrivateObjectStorage implements PrivateObjectStorage {
  readonly #aws: AwsClient;
  readonly #baseUrl: string;
  readonly #bucket: string;

  public constructor(config: R2PrivateObjectStorageConfig) {
    this.#aws = new AwsClient({
      accessKeyId: config.accessKeyId,
      region: 'auto',
      secretAccessKey: config.secretAccessKey,
      service: 's3',
    });
    this.#baseUrl = `https://${config.accountId}.r2.cloudflarestorage.com`;
    this.#bucket = config.bucket;
  }

  public async createDownloadGrant(input: {
    readonly downloadName: string;
    readonly expiresInSeconds: number;
    readonly objectKey: string;
  }): Promise<PrivateObjectGrant> {
    const url = this.#objectUrl(input.objectKey);
    url.searchParams.set('X-Amz-Expires', String(input.expiresInSeconds));
    url.searchParams.set(
      'response-content-disposition',
      `attachment; filename="${safeDownloadName(input.downloadName)}"`,
    );
    const request = await this.#aws.sign(new Request(url, { method: 'GET' }), {
      aws: { allHeaders: true, signQuery: true },
    });
    return this.#grant(request, input.expiresInSeconds, {});
  }

  public async createUploadGrant(input: {
    readonly byteLength: number;
    readonly contentType: string;
    readonly expiresInSeconds: number;
    readonly objectKey: string;
    readonly sha256: string;
  }): Promise<PrivateObjectGrant> {
    const headers = Object.freeze({
      'content-type': input.contentType,
      'x-amz-meta-pdfmason-sha256': input.sha256,
    });
    const url = this.#objectUrl(input.objectKey);
    url.searchParams.set('X-Amz-Expires', String(input.expiresInSeconds));
    const request = await this.#aws.sign(new Request(url, { headers, method: 'PUT' }), {
      aws: { allHeaders: true, signQuery: true },
    });
    return this.#grant(request, input.expiresInSeconds, headers);
  }

  public async delete(objectKey: string): Promise<void> {
    const response = await this.#aws.fetch(this.#objectUrl(objectKey), { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error('R2_DELETE_FAILED');
  }

  public async exists(objectKey: string): Promise<boolean> {
    return (await this.head(objectKey)) !== null;
  }

  public async head(objectKey: string): Promise<PrivateObjectHead | null> {
    const response = await this.#aws.fetch(this.#objectUrl(objectKey), { method: 'HEAD' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('R2_HEAD_FAILED');
    const byteLength = Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0)
      throw new Error('R2_METADATA_INVALID');
    return Object.freeze({
      byteLength,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      sha256: response.headers.get('x-amz-meta-pdfmason-sha256'),
    });
  }

  #grant(
    request: Request,
    expiresInSeconds: number,
    headers: Readonly<Record<string, string>>,
  ): PrivateObjectGrant {
    return Object.freeze({
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      headers,
      method: request.method as 'GET' | 'PUT',
      url: request.url,
    });
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

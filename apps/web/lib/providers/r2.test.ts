import { describe, expect, it } from 'vitest';

import { createOpaqueStorageKey, R2PrivateObjectStorage } from './r2';

describe('private R2 adapter', () => {
  it('creates opaque, method-bound, short-lived upload grants', async () => {
    const key = createOpaqueStorageKey({
      environment: 'staging',
      jobId: '61111111-1111-4111-8111-111111111111',
      objectId: '62222222-2222-4222-8222-222222222222',
      role: 'input',
      workspaceId: '63333333-3333-4333-8333-333333333333',
    });
    expect(key).not.toContain('.pdf');
    const storage = new R2PrivateObjectStorage({
      accessKeyId: 'synthetic-access-key',
      accountId: 'syntheticaccountid',
      bucket: 'private-fixtures',
      secretAccessKey: 'synthetic-secret-key-value',
    });
    const grant = await storage.createUploadGrant({
      byteLength: 128,
      contentType: 'application/pdf',
      expiresInSeconds: 60,
      objectKey: key,
      sha256: 'a'.repeat(64),
    });

    const signed = new URL(grant.url);
    expect(grant.method).toBe('PUT');
    expect(grant.headers).toEqual({
      'content-type': 'application/pdf',
      'x-amz-meta-pdfmason-sha256': 'a'.repeat(64),
    });
    expect(signed.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(signed.searchParams.has('X-Amz-Signature')).toBe(true);
    expect(grant.url).not.toContain('medical-record');
  });

  it('rejects traversal-like object keys before signing', async () => {
    const storage = new R2PrivateObjectStorage({
      accessKeyId: 'synthetic-access-key',
      accountId: 'syntheticaccountid',
      bucket: 'private-fixtures',
      secretAccessKey: 'synthetic-secret-key-value',
    });
    await expect(
      storage.createDownloadGrant({
        downloadName: 'output.pdf',
        expiresInSeconds: 60,
        objectKey: 'staging/../../restricted-object',
      }),
    ).rejects.toThrow('R2_OBJECT_KEY_INVALID');
  });
});

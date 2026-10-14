import { describe, expect, it } from 'vitest';

import {
  calculateDeleteAfter,
  canTransitionCloudJob,
  createCloudJobRequestSchema,
  isWebhookNewer,
  objectGrantSchema,
  retentionPolicySchema,
  uploadAuthorizationRequestSchema,
} from './saas.js';

describe('SaaS boundary contracts', () => {
  it('accepts content-free upload metadata and rejects filenames and unknown fields', () => {
    const valid = {
      byteLength: 128,
      contentType: 'application/pdf',
      idempotencyKey: 'upload-request-000001',
      operation: 'demo.integrity',
      operationVersion: '1.0.0',
      sha256: 'a'.repeat(64),
    };
    expect(uploadAuthorizationRequestSchema.strict().parse(valid)).toEqual(valid);
    expect(() =>
      uploadAuthorizationRequestSchema.strict().parse({ ...valid, filename: 'private-client.pdf' }),
    ).toThrow();
  });

  it('rejects unbounded or content-bearing job options', () => {
    const base = {
      idempotencyKey: 'request-unique-0001',
      inputObjectId: 'object_opaque_0001',
      operation: 'demo.integrity',
      operationVersion: '1.0.0',
    };
    expect(createCloudJobRequestSchema.parse({ ...base, options: { verifySha256: true } })).toEqual(
      {
        ...base,
        options: { verifySha256: true },
      },
    );
    expect(() =>
      createCloudJobRequestSchema.parse({
        ...base,
        options: { nested: { pdfText: 'restricted' } },
      }),
    ).toThrow();
    for (const sensitiveName of ['password', 'ownerPassword', 'authorizationToken', 'filename']) {
      expect(() =>
        createCloudJobRequestSchema.parse({
          ...base,
          options: { [sensitiveName]: 'must-not-cross-cloud-boundary' },
        }),
      ).toThrow();
    }
  });

  it('allows only documented job-state transitions', () => {
    expect(canTransitionCloudJob('awaiting_upload', 'queued')).toBe(true);
    expect(canTransitionCloudJob('processing', 'completed')).toBe(true);
    expect(canTransitionCloudJob('completed', 'processing')).toBe(false);
    expect(canTransitionCloudJob('deleted', 'queued')).toBe(false);
  });

  it('calculates UTC deletion deadlines and enforces the 24-hour safety net', () => {
    expect(calculateDeleteAfter(new Date('2026-08-21T12:00:00.000Z'), 1)).toBe(
      '2026-08-21T13:00:00.000Z',
    );
    expect(
      retentionPolicySchema.parse({ historyDays: 30, outputHours: 1, safetyNetHours: 24 }),
    ).toEqual({ historyDays: 30, outputHours: 1, safetyNetHours: 24 });
    expect(() =>
      retentionPolicySchema.parse({ historyDays: 30, outputHours: 24, safetyNetHours: 1 }),
    ).toThrow();
  });

  it('orders webhook updates deterministically and rejects stale events', () => {
    const current = { createdAt: '2026-08-21T12:00:00.000Z', eventId: 'evt_b' };
    expect(
      isWebhookNewer({ createdAt: '2026-08-21T12:00:01.000Z', eventId: 'evt_a' }, current),
    ).toBe(true);
    expect(isWebhookNewer({ createdAt: current.createdAt, eventId: 'evt_c' }, current)).toBe(true);
    expect(isWebhookNewer({ createdAt: current.createdAt, eventId: 'evt_a' }, current)).toBe(false);
  });

  it('keeps storage keys out of public grant responses', () => {
    const grant = objectGrantSchema.strict().parse({
      expiresAt: '2026-08-21T12:05:00.000Z',
      headers: { 'content-type': 'application/pdf' },
      method: 'PUT',
      objectId: 'object_opaque_0001',
      url: 'https://storage.example.invalid/grant/opaque',
    });
    expect(JSON.stringify(grant)).not.toContain('workspace/');
    expect(() =>
      objectGrantSchema.strict().parse({ ...grant, storageKey: 'workspace/private' }),
    ).toThrow();
  });
});

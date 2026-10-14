import { describe, expect, it } from 'vitest';

import {
  FakeBillingGateway,
  FakeEntitlementService,
  FakeSubscriptionBillingGateway,
  InMemoryJobCoordinator,
  InMemoryObjectStorage,
  InMemoryPrivateObjectStorage,
} from './fakes.js';

const clock = () => new Date('2026-08-21T12:00:00.000Z');

describe('foundation provider fakes', () => {
  it('copies object bytes and deletes idempotently', async () => {
    const storage = new InMemoryObjectStorage({ clock, idFactory: () => 'object-1' });
    const source = new Uint8Array([1, 2, 3]);
    const metadata = await storage.put({
      bytes: source,
      contentType: 'application/pdf',
      sha256: 'fixture-hash',
    });
    source[0] = 9;

    expect(await storage.get(metadata.objectId)).toEqual(new Uint8Array([1, 2, 3]));
    await storage.delete(metadata.objectId);
    await storage.delete(metadata.objectId);
    expect(await storage.get(metadata.objectId)).toBeNull();
  });

  it('deduplicates fake jobs by idempotency key', async () => {
    let nextId = 0;
    const jobs = new InMemoryJobCoordinator({
      clock,
      idFactory: () => `job-${(nextId += 1)}`,
    });
    const request = {
      idempotencyKey: 'same-request',
      operation: 'foundation.noop',
      options: {},
      workspaceId: 'workspace-1',
    } as const;

    const first = await jobs.enqueue(request);
    const second = await jobs.enqueue(request);
    expect(first).toBe(second);
    expect((await jobs.claim())?.state).toBe('claimed');
  });

  it('keeps fake billing and entitlements disabled until explicitly configured', async () => {
    const billing = new FakeBillingGateway(() => 'checkout-1');
    const entitlements = new FakeEntitlementService();

    expect(await entitlements.resolve('workspace-1', 'ocr.cloud')).toMatchObject({
      enabled: false,
      revision: 0,
    });
    expect(
      await billing.createCheckout({
        planKey: 'development-only',
        returnUrl: 'http://localhost:3000',
        workspaceId: 'workspace-1',
      }),
    ).toEqual({ checkoutId: 'checkout-1', provider: 'fake' });
  });
});

describe('Milestone 3 provider fakes', () => {
  const clock = () => new Date('2026-08-21T12:00:00.000Z');

  it('mints method-bound grants without returning the private object key', async () => {
    const storage = new InMemoryPrivateObjectStorage(clock);
    const grant = await storage.createUploadGrant({
      byteLength: 256,
      contentType: 'application/pdf',
      expiresInSeconds: 300,
      objectKey: 'development/workspace/job/input',
      sha256: 'a'.repeat(64),
    });

    expect(grant.method).toBe('PUT');
    expect(grant.expiresAt).toBe('2026-08-21T12:05:00.000Z');
    expect(grant.url).not.toContain('development/workspace/job/input');
    expect(await storage.head('development/workspace/job/input')).toEqual({
      byteLength: 256,
      contentType: 'application/pdf',
      sha256: 'a'.repeat(64),
    });
  });

  it('keeps checkout and portal inputs server-controlled', async () => {
    const billing = new FakeSubscriptionBillingGateway({
      clock,
      idFactory: () => 'provider-reference',
    });
    const checkout = await billing.createCheckout({
      cancelUrl: 'https://app.example.invalid/account/billing',
      idempotencyKey: 'checkout-idempotency-1',
      planKey: 'pro_monthly',
      successUrl: 'https://app.example.invalid/account/billing',
      userEmail: 'synthetic@example.invalid',
      workspaceId: '11111111-1111-4111-8111-111111111111',
    });

    expect(checkout.url).toContain('/checkout/');
    expect(billing.checkoutRequests[0]?.planKey).toBe('pro_monthly');
    expect(billing.checkoutRequests[0]).not.toHaveProperty('priceId');
  });
});

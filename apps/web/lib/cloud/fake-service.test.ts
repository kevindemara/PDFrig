import { describe, expect, it } from 'vitest';

import type { AuthenticatedPrincipal } from '../auth';
import { FakeCloudService } from './fake-service';

const principal = (user: string, workspace: string): AuthenticatedPrincipal => ({
  authenticatedAt: 0,
  email: `${user}@example.invalid`,
  emailVerified: true,
  userId: user,
  workspaceId: workspace,
});

describe('fake SaaS service', () => {
  it('scopes idempotency and job reads to the authenticated workspace', async () => {
    const ids = ['61111111-1111-4111-8111-111111111111', '62222222-2222-4222-8222-222222222222'];
    const service = new FakeCloudService({
      clock: () => new Date('2026-08-21T12:00:00.000Z'),
      idFactory: () => ids.shift() ?? crypto.randomUUID(),
    });
    const ownerOne = principal(
      '71111111-1111-4111-8111-111111111111',
      '81111111-1111-4111-8111-111111111111',
    );
    const ownerTwo = principal(
      '72222222-2222-4222-8222-222222222222',
      '82222222-2222-4222-8222-222222222222',
    );

    const first = await service.createDemoJob(ownerOne, 'same-request-key-0001');
    const replay = await service.createDemoJob(ownerOne, 'same-request-key-0001');
    const otherWorkspace = await service.createDemoJob(ownerTwo, 'same-request-key-0001');

    expect(replay.id).toBe(first.id);
    expect(otherWorkspace.id).not.toBe(first.id);
    expect(await service.getJob(ownerTwo, first.id)).toBeNull();
    expect(await service.cancelJob(ownerTwo, first.id)).toBeNull();
    expect((await service.getAccount(ownerOne)).jobs).toHaveLength(1);
    expect((await service.getAccount(ownerTwo)).jobs).toHaveLength(1);
  });

  it('reports truthful staged progress and immediate deletion', async () => {
    let now = new Date('2026-08-21T12:00:00.000Z');
    const service = new FakeCloudService({
      clock: () => now,
      idFactory: () => '63333333-3333-4333-8333-333333333333',
    });
    const owner = principal(
      '73333333-3333-4333-8333-333333333333',
      '83333333-3333-4333-8333-333333333333',
    );
    const job = await service.createDemoJob(owner, 'progress-request-0001');
    now = new Date('2026-08-21T12:00:00.700Z');
    expect((await service.getJob(owner, job.id))?.state).toBe('processing');
    now = new Date('2026-08-21T12:00:02.000Z');
    expect((await service.getJob(owner, job.id))?.state).toBe('completed');
    expect((await service.deleteJob(owner, job.id))?.state).toBe('deleted');
  });
});

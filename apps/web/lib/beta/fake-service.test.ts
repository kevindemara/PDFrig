import { describe, expect, it } from 'vitest';

import { FakeBetaService } from './fake-service';

describe('local beta service fake', () => {
  it('returns an opaque receipt while retaining only content-free counters', async () => {
    const service = new FakeBetaService(() => new Date('2026-08-24T20:00:00.000Z'));
    const supportReceipt = await service.submitSupport({
      applicationVersion: 'local',
      category: 'privacy',
      consentToContact: true,
      platform: 'web',
      replyEmail: 'private@example.test',
      requestId: 'request_fixture_01',
    });
    await service.submitFeedback({
      applicationVersion: 'local',
      consentToAggregate: true,
      featureId: 'VIEW-001',
      outcome: 'completed',
      platform: 'web',
      rating: 5,
    });
    await service.recordAnalytics({
      event: 'page_view',
      eventId: 'b36ea971-2e3d-4e21-a587-72ce60a730ee',
      occurredAt: '2026-08-24T20:00:00.000Z',
      surface: 'help',
    });

    expect(supportReceipt.receivedAt).toBe('2026-08-24T20:00:00.000Z');
    expect(supportReceipt.reference).toMatch(/^BETA-[A-F0-9]{12}$/u);
    const serialized = JSON.stringify(service.snapshot());
    expect(serialized).toContain('privacy');
    expect(serialized).not.toContain('private@example.test');
    expect(serialized).not.toContain('request_fixture_01');
  });
});

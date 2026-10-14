import { describe, expect, it } from 'vitest';

import {
  betaAnalyticsEventSchema,
  betaFeedbackRequestSchema,
  betaSupportRequestSchema,
} from './beta.js';

describe('public beta content-free boundaries', () => {
  it('accepts structured support diagnostics without a document narrative', () => {
    expect(
      betaSupportRequestSchema.parse({
        applicationVersion: '0.1.0-alpha.1',
        category: 'windows',
        consentToContact: true,
        errorCode: 'NATIVE_FILE_CHANGED',
        platform: 'windows',
        replyEmail: 'fixture@example.test',
        requestId: 'request_fixture_01',
      }),
    ).toMatchObject({ category: 'windows', errorCode: 'NATIVE_FILE_CHANGED' });
  });

  it('rejects free text, filenames, document text, and unknown feature IDs', () => {
    const base = {
      applicationVersion: 'local',
      category: 'local_tool',
      consentToContact: true,
      platform: 'web',
      replyEmail: 'fixture@example.test',
    } as const;
    expect(() =>
      betaSupportRequestSchema.parse({ ...base, message: 'document contents' }),
    ).toThrow();
    expect(() => betaSupportRequestSchema.parse({ ...base, filename: 'private.pdf' })).toThrow();
    expect(() =>
      betaFeedbackRequestSchema.parse({
        applicationVersion: 'local',
        consentToAggregate: true,
        documentText: 'private',
        featureId: 'NOT-A-FEATURE',
        outcome: 'blocked',
        platform: 'web',
        rating: 2,
      }),
    ).toThrow();
  });

  it('allows only approved content-free analytics dimensions', () => {
    const event = {
      event: 'page_view',
      eventId: 'b36ea971-2e3d-4e21-a587-72ce60a730ee',
      occurredAt: '2026-08-24T20:00:00.000Z',
      surface: 'pricing',
    } as const;
    expect(betaAnalyticsEventSchema.parse(event)).toEqual(event);
    expect(() =>
      betaAnalyticsEventSchema.parse({
        ...event,
        filename: 'private.pdf',
        pathname: '/jobs/secret',
      }),
    ).toThrow();
  });
});

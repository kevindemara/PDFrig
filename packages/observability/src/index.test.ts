import { describe, expect, it } from 'vitest';

import {
  ACTIONABLE_ALERTS,
  createSafeLogger,
  isSafeLogContextField,
  sanitizeLogContext,
} from './index.js';

describe('safe structured logging', () => {
  it('removes sensitive and unknown field names instead of serializing their values', () => {
    const safe = sanitizeLogContext({
      authorization: 'Bearer secret-token',
      cookie: 'session=secret',
      filename: 'medical-record.pdf',
      objectKey: 'tenant/private.pdf',
      operation: 'foundation.start',
      password: 'correct horse battery staple',
      pdfText: 'restricted document contents',
      requestId: 'request-1',
      signedUrl: 'https://storage.invalid/private?signature=secret',
    });

    expect(safe).toEqual({ operation: 'foundation.start', requestId: 'request-1' });
    const serialized = JSON.stringify(safe);
    for (const forbidden of [
      'authorization',
      'cookie',
      'filename',
      'objectKey',
      'password',
      'pdfText',
      'signedUrl',
      'medical-record.pdf',
      'secret-token',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('keeps every actionable alert on safe dimensions with a repository runbook', () => {
    expect(ACTIONABLE_ALERTS.length).toBeGreaterThanOrEqual(7);
    expect(new Set(ACTIONABLE_ALERTS.map(({ id }) => id)).size).toBe(ACTIONABLE_ALERTS.length);
    for (const alert of ACTIONABLE_ALERTS) {
      expect(alert.runbook).toMatch(/^docs\/operations\/handbook\.txt#[a-z-]+$/u);
      expect(alert.safeDimensions.every(isSafeLogContextField)).toBe(true);
      expect(alert.signal).not.toMatch(/filename|document|object key|pdf text|signed url/iu);
    }
  });

  it('emits stable JSON with UTC timestamps and safe context', () => {
    const entries: string[] = [];
    const logger = createSafeLogger(
      (entry) => entries.push(entry),
      () => new Date('2026-08-21T12:34:56.000Z'),
    );
    logger.log('info', 'worker.ready', { environment: 'test', workerVersion: '0.0.0' });

    expect(JSON.parse(entries[0] ?? '')).toEqual({
      context: { environment: 'test', workerVersion: '0.0.0' },
      event: 'worker.ready',
      level: 'info',
      timestamp: '2026-08-21T12:34:56.000Z',
    });
  });
});

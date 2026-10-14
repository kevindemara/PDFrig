import { describe, expect, it } from 'vitest';

import { ApiFault } from '../api';
import { throwCloudDatabaseFault } from './database-fault';

describe('cloud database denial mapping', () => {
  it.each([
    ['IDEMPOTENCY_CONFLICT', 'STATE_CONFLICT', 409],
    ['INVALID_JOB_RESERVATION', 'INPUT_INVALID', 400],
    ['SENSITIVE_JOB_OPTION_FORBIDDEN', 'INPUT_INVALID', 400],
    ['USAGE_UNIT_MISMATCH', 'INPUT_INVALID', 400],
    ['WORKSPACE_ACCESS_DENIED', 'NOT_FOUND', 404],
    ['ENTITLEMENT_REQUIRED', 'ENTITLEMENT_REQUIRED', 403],
    ['QUOTA_EXCEEDED', 'QUOTA_EXCEEDED', 409],
  ])('maps exact %s to a non-retryable safe response', (message, code, status) => {
    try {
      throwCloudDatabaseFault(message);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiFault);
      expect(error).toMatchObject({ code, status, retryable: false });
      expect((error as ApiFault).message).not.toContain(message);
    }
  });

  it.each(['private-canary.pdf', 'SQL detail: IDEMPOTENCY_CONFLICT private-canary', ''])(
    'never exposes or classifies arbitrary provider text',
    (message) => {
      try {
        throwCloudDatabaseFault(message);
      } catch (error) {
        expect(error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', status: 503, retryable: true });
        expect((error as ApiFault).message).toBe('The operation stopped safely. Try again later.');
      }
    },
  );
});

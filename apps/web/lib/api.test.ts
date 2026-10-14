import { describe, expect, it } from 'vitest';

import { ApiFault, requireMutationOrigin } from './api';

describe('cookie-authenticated mutation boundary', () => {
  it('accepts an exact configured origin and rejects missing or lookalike origins', () => {
    expect(() =>
      requireMutationOrigin(
        new Request('http://127.0.0.1:3000/api/v1/jobs/demo', {
          headers: { origin: 'http://127.0.0.1:3000' },
          method: 'POST',
        }),
      ),
    ).not.toThrow();
    for (const origin of [null, 'not-a-url', 'http://127.0.0.1.evil.invalid:3000']) {
      const headers = origin === null ? {} : { origin };
      expect(() =>
        requireMutationOrigin(
          new Request('http://127.0.0.1:3000/api/v1/jobs/demo', { headers, method: 'POST' }),
        ),
      ).toThrow(ApiFault);
    }
  });
});

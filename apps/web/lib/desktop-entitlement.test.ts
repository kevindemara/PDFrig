import { generateKeyPairSync, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { desktopEntitlementPayloadSchema } from '@pdfmason/contracts';

import { parseDesktopBearerToken, signDesktopEntitlement } from './desktop-entitlement';

const signingFixture = () => {
  const pair = generateKeyPairSync('ed25519');
  return {
    config: {
      keyId: 'ephemeral-test-key',
      privateKey: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    },
    publicKey: pair.publicKey,
  };
};

const payload = desktopEntitlementPayloadSchema.parse({
  audience: 'pdfmason-desktop',
  entitlement: { enabled: true, featureKey: 'desktop.full', revision: 9 },
  expiresAt: '2026-08-25T12:00:00.000Z',
  featureIds: ['VIEW-001', 'ORG-003'],
  issuedAt: '2026-08-24T12:00:00.000Z',
  offlineGraceUntil: '2026-09-01T12:00:00.000Z',
  userId: '11111111-1111-4111-8111-111111111111',
  version: 1,
  workspaceId: '22222222-2222-4222-8222-222222222222',
});

describe('desktop entitlement issuance', () => {
  it('signs only the encoded payload with an ephemeral Ed25519 key', () => {
    const fixture = signingFixture();
    const envelope = signDesktopEntitlement(payload, fixture.config);
    expect(
      verify(
        null,
        Buffer.from(envelope.payload, 'base64url'),
        fixture.publicKey,
        Buffer.from(envelope.signature, 'base64url'),
      ),
    ).toBe(true);
    expect(
      desktopEntitlementPayloadSchema.parse(
        JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8')),
      ),
    ).toEqual(payload);
  });

  it('accepts one bounded bearer token and rejects malformed authorization', () => {
    const token = 'synthetic.header.signature-value';
    expect(
      parseDesktopBearerToken(
        new Request('http://127.0.0.1/api', { headers: { authorization: `Bearer ${token}` } }),
      ),
    ).toBe(token);
    expect(() => parseDesktopBearerToken(new Request('http://127.0.0.1/api'))).toThrow(
      'Sign in to verify desktop access',
    );
    expect(() =>
      parseDesktopBearerToken(
        new Request('http://127.0.0.1/api', { headers: { authorization: 'Basic secret' } }),
      ),
    ).toThrow('Sign in to verify desktop access');
  });
});

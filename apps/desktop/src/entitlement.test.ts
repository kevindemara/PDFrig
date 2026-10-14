import { describe, expect, it } from 'vitest';

import type { DesktopEntitlementPayload, SignedDesktopEntitlement } from '@pdfmason/contracts';

import {
  DesktopEntitlementManager,
  evaluateDesktopEntitlement,
  verifyDesktopEntitlement,
  type DesktopEntitlementConfig,
} from './entitlement.js';

const base64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
};

const base64Url = (bytes: Uint8Array): string =>
  base64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');

const payload = (
  revision = 4,
  issuedAt = '2026-08-24T12:00:00.000Z',
): DesktopEntitlementPayload => ({
  audience: 'pdfmason-desktop',
  entitlement: { enabled: true, featureKey: 'desktop.full', revision },
  expiresAt: new Date(Date.parse(issuedAt) + 24 * 60 * 60 * 1000).toISOString(),
  featureIds: ['VIEW-001', 'ORG-003'],
  issuedAt,
  offlineGraceUntil: new Date(Date.parse(issuedAt) + 8 * 24 * 60 * 60 * 1000).toISOString(),
  userId: '11111111-1111-4111-8111-111111111111',
  version: 1,
  workspaceId: '22222222-2222-4222-8222-222222222222',
});

const signingFixture = async (): Promise<{
  readonly config: DesktopEntitlementConfig;
  readonly sign: (value: DesktopEntitlementPayload) => Promise<SignedDesktopEntitlement>;
}> => {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const config = {
    endpoint: 'https://app.example.invalid/api/v1/desktop/entitlement',
    keyId: 'synthetic-test-key',
    publicKeySpki: base64(publicKey),
  };
  return {
    config,
    sign: async (value) => {
      const encodedPayload = new TextEncoder().encode(JSON.stringify(value));
      const signature = new Uint8Array(
        await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, encodedPayload),
      );
      return {
        algorithm: 'Ed25519',
        keyId: config.keyId,
        payload: base64Url(encodedPayload),
        signature: base64Url(signature),
      };
    },
  };
};

describe('signed desktop entitlements', () => {
  it('verifies an ephemeral Ed25519 signature and rejects tampering', async () => {
    const fixture = await signingFixture();
    const envelope = await fixture.sign(payload());
    await expect(verifyDesktopEntitlement(envelope, fixture.config)).resolves.toMatchObject({
      entitlement: { revision: 4 },
    });

    const firstCharacter = envelope.signature.startsWith('A') ? 'B' : 'A';
    const tampered = { ...envelope, signature: `${firstCharacter}${envelope.signature.slice(1)}` };
    await expect(verifyDesktopEntitlement(tampered, fixture.config)).rejects.toThrow(
      'ENTITLEMENT_SIGNATURE_INVALID',
    );
  });

  it('allows only bounded local grace and rejects wall-clock rollback', () => {
    const signed = payload();
    expect(
      evaluateDesktopEntitlement(
        signed,
        new Date('2026-08-25T18:00:00.000Z'),
        new Date('2026-08-25T12:00:00.000Z'),
      ),
    ).toMatchObject({ cloudAllowed: false, localDesktopAllowed: true, status: 'offline_grace' });
    expect(
      evaluateDesktopEntitlement(
        signed,
        new Date('2026-08-23T00:00:00.000Z'),
        new Date('2026-08-25T12:00:00.000Z'),
      ),
    ).toMatchObject({ localDesktopAllowed: false, status: 'clock_invalid' });
    expect(
      evaluateDesktopEntitlement(
        signed,
        new Date('2026-09-03T00:00:00.000Z'),
        new Date('2026-08-25T12:00:00.000Z'),
      ),
    ).toMatchObject({ localDesktopAllowed: false, status: 'expired' });
  });

  it('retains a monotonic cached revision and never authorizes cloud work', async () => {
    const fixture = await signingFixture();
    let secureCache: string | null = null;
    const invoke = <T>(
      command: string,
      arguments_?: Readonly<Record<string, unknown>>,
    ): Promise<T> => {
      if (command === 'get_secure_entitlement') return Promise.resolve(secureCache as T);
      if (command === 'store_secure_entitlement') {
        secureCache = String(arguments_?.entitlementJson);
        return Promise.resolve(null as T);
      }
      secureCache = null;
      return Promise.resolve(null as T);
    };
    let responseEnvelope = await fixture.sign(payload(5));
    const manager = new DesktopEntitlementManager(fixture.config, invoke, () =>
      Promise.resolve(new Response(JSON.stringify(responseEnvelope), { status: 200 })),
    );
    await expect(
      manager.refresh(
        'synthetic-access-token',
        '11111111-1111-4111-8111-111111111111',
        new Date('2026-08-24T13:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ cloudAllowed: false, status: 'active' });

    responseEnvelope = await fixture.sign(payload(4));
    await expect(
      manager.refresh(
        'synthetic-access-token',
        '11111111-1111-4111-8111-111111111111',
        new Date('2026-08-24T14:00:00.000Z'),
      ),
    ).rejects.toThrow('ENTITLEMENT_REVISION_ROLLBACK');
  });
});

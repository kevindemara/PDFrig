import type { SupabaseClient } from '@supabase/supabase-js';

import {
  desktopEntitlementCacheSchema,
  desktopEntitlementPayloadSchema,
  signedDesktopEntitlementSchema,
  type DesktopEntitlementCache,
  type DesktopEntitlementPayload,
  type SignedDesktopEntitlement,
} from '@pdfmason/contracts';

const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;
const MAXIMUM_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const MAXIMUM_SIGNED_TTL_MS = 48 * 60 * 60 * 1000;

type NativeInvoke = <T>(
  command: string,
  arguments_?: Readonly<Record<string, unknown>>,
) => Promise<T>;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface DesktopEntitlementConfig {
  readonly endpoint: string;
  readonly keyId: string;
  readonly publicKeySpki: string;
}

export interface DesktopEntitlementDecision {
  readonly cloudAllowed: false;
  readonly localDesktopAllowed: boolean;
  readonly payload: DesktopEntitlementPayload | null;
  readonly status:
    'active' | 'clock_invalid' | 'disabled' | 'expired' | 'offline_grace' | 'unavailable';
}

const unavailable = (): DesktopEntitlementDecision =>
  Object.freeze({
    cloudAllowed: false,
    localDesktopAllowed: false,
    payload: null,
    status: 'unavailable',
  });

const decodeBase64 = (value: string): Uint8Array => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const decodeBase64Buffer = (value: string): ArrayBuffer => {
  const bytes = decodeBase64(value);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const decodeSignedPayload = (encoded: string): DesktopEntitlementPayload =>
  desktopEntitlementPayloadSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(encoded))),
  );

const validateSignedTimeline = (payload: DesktopEntitlementPayload): void => {
  const issued = Date.parse(payload.issuedAt);
  const expires = Date.parse(payload.expiresAt);
  const grace = Date.parse(payload.offlineGraceUntil);
  if (
    expires < issued ||
    expires - issued > MAXIMUM_SIGNED_TTL_MS ||
    grace < expires ||
    grace - expires > MAXIMUM_GRACE_MS
  ) {
    throw new Error('ENTITLEMENT_TIMELINE_INVALID');
  }
};

export const verifyDesktopEntitlement = async (
  envelopeInput: unknown,
  config: DesktopEntitlementConfig,
): Promise<DesktopEntitlementPayload> => {
  const envelope = signedDesktopEntitlementSchema.parse(envelopeInput);
  if (envelope.keyId !== config.keyId) throw new Error('ENTITLEMENT_KEY_UNKNOWN');
  const key = await globalThis.crypto.subtle.importKey(
    'spki',
    decodeBase64Buffer(config.publicKeySpki),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  const verified = await globalThis.crypto.subtle.verify(
    { name: 'Ed25519' },
    key,
    decodeBase64Buffer(envelope.signature),
    decodeBase64Buffer(envelope.payload),
  );
  if (!verified) throw new Error('ENTITLEMENT_SIGNATURE_INVALID');
  const payload = decodeSignedPayload(envelope.payload);
  validateSignedTimeline(payload);
  return payload;
};

export const evaluateDesktopEntitlement = (
  payload: DesktopEntitlementPayload,
  now: Date,
  lastObservedAt: Date,
): DesktopEntitlementDecision => {
  const current = now.getTime();
  if (current + CLOCK_ROLLBACK_TOLERANCE_MS < lastObservedAt.getTime())
    return Object.freeze({
      cloudAllowed: false,
      localDesktopAllowed: false,
      payload,
      status: 'clock_invalid',
    });
  if (!payload.entitlement.enabled)
    return Object.freeze({
      cloudAllowed: false,
      localDesktopAllowed: false,
      payload,
      status: 'disabled',
    });
  if (current <= Date.parse(payload.expiresAt))
    return Object.freeze({
      cloudAllowed: false,
      localDesktopAllowed: true,
      payload,
      status: 'active',
    });
  if (current <= Date.parse(payload.offlineGraceUntil))
    return Object.freeze({
      cloudAllowed: false,
      localDesktopAllowed: true,
      payload,
      status: 'offline_grace',
    });
  return Object.freeze({
    cloudAllowed: false,
    localDesktopAllowed: false,
    payload,
    status: 'expired',
  });
};

export class DesktopEntitlementManager {
  readonly #config: DesktopEntitlementConfig;
  readonly #fetch: FetchLike;
  readonly #invokeCommand: NativeInvoke;

  public constructor(
    config: DesktopEntitlementConfig,
    invokeCommand: NativeInvoke,
    fetch: FetchLike,
  ) {
    this.#config = config;
    this.#fetch = fetch;
    this.#invokeCommand = invokeCommand;
  }

  async #readCache(): Promise<DesktopEntitlementCache | null> {
    const value = await this.#invokeCommand<string | null>('get_secure_entitlement');
    return value === null ? null : desktopEntitlementCacheSchema.parse(JSON.parse(value));
  }

  async #verifiedCache(expectedUserId: string): Promise<{
    readonly cache: DesktopEntitlementCache;
    readonly payload: DesktopEntitlementPayload;
  } | null> {
    const cache = await this.#readCache();
    if (cache === null) return null;
    const payload = await verifyDesktopEntitlement(cache.envelope, this.#config);
    if (payload.userId !== expectedUserId) return null;
    return { cache, payload };
  }

  public async clear(): Promise<void> {
    await this.#invokeCommand<null>('clear_secure_entitlement');
  }

  public async load(expectedUserId: string, now = new Date()): Promise<DesktopEntitlementDecision> {
    try {
      const verified = await this.#verifiedCache(expectedUserId);
      if (verified === null) return unavailable();
      const lastObserved = new Date(verified.cache.lastObservedAt);
      const decision = evaluateDesktopEntitlement(verified.payload, now, lastObserved);
      if (decision.status !== 'clock_invalid' && now.getTime() > lastObserved.getTime()) {
        await this.#store(verified.cache.envelope, now);
      }
      return decision;
    } catch {
      await this.clear().catch(() => undefined);
      return unavailable();
    }
  }

  async #store(envelope: SignedDesktopEntitlement, lastObservedAt: Date): Promise<void> {
    await this.#invokeCommand<null>('store_secure_entitlement', {
      entitlementJson: JSON.stringify({ envelope, lastObservedAt: lastObservedAt.toISOString() }),
    });
  }

  public async refresh(
    accessToken: string,
    expectedUserId: string,
    now = new Date(),
  ): Promise<DesktopEntitlementDecision> {
    const response = await this.#fetch(this.#config.endpoint, {
      cache: 'no-store',
      headers: { authorization: `Bearer ${accessToken}` },
      method: 'GET',
    });
    if (!response.ok) throw new Error('ENTITLEMENT_REFRESH_FAILED');
    const body = await response.text();
    if (body.length > 32_768) throw new Error('ENTITLEMENT_RESPONSE_LIMIT');
    const envelope = signedDesktopEntitlementSchema.parse(JSON.parse(body));
    const payload = await verifyDesktopEntitlement(envelope, this.#config);
    if (payload.userId !== expectedUserId) throw new Error('ENTITLEMENT_SUBJECT_MISMATCH');
    const existing = await this.#verifiedCache(expectedUserId).catch(() => null);
    if (
      existing !== null &&
      existing.payload.workspaceId === payload.workspaceId &&
      payload.entitlement.revision < existing.payload.entitlement.revision
    ) {
      throw new Error('ENTITLEMENT_REVISION_ROLLBACK');
    }
    await this.#store(envelope, now);
    return evaluateDesktopEntitlement(payload, now, now);
  }
}

export const parseDesktopEntitlementConfig = (
  input: Readonly<Record<string, string | undefined>>,
): DesktopEntitlementConfig | null => {
  const keyId = input.VITE_PDFMASON_ENTITLEMENT_KEY_ID?.trim();
  const publicKeySpki = input.VITE_PDFMASON_ENTITLEMENT_PUBLIC_KEY?.trim();
  if (keyId === undefined && publicKeySpki === undefined) return null;
  if (
    keyId === undefined ||
    !/^[A-Za-z0-9._-]{3,64}$/u.test(keyId) ||
    publicKeySpki === undefined ||
    publicKeySpki.length < 40
  ) {
    throw new Error('Desktop entitlement verification configuration is incomplete.');
  }
  const endpoint = new URL(
    '/api/v1/desktop/entitlement',
    input.VITE_PDFMASON_WEB_URL ?? 'http://127.0.0.1:3000',
  ).toString();
  return Object.freeze({ endpoint, keyId, publicKeySpki });
};

export const refreshDesktopEntitlementForSession = async (
  manager: DesktopEntitlementManager,
  client: SupabaseClient,
): Promise<DesktopEntitlementDecision> => {
  const { data, error } = await client.auth.getSession();
  if (error !== null || data.session === null) return unavailable();
  return manager.refresh(data.session.access_token, data.session.user.id);
};

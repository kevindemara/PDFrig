import { createPrivateKey, sign } from 'node:crypto';

import {
  FEATURE_IDS,
  FEATURE_REGISTRY,
  desktopEntitlementPayloadSchema,
  signedDesktopEntitlementSchema,
  type DesktopEntitlementPayload,
  type SignedDesktopEntitlement,
} from '@pdfmason/contracts';
import { parseServerConfig } from '@pdfmason/config/server';
import { z } from 'zod';

import { ApiFault } from './api';
import { createSupabaseAdminClient } from './supabase/admin';

const bearerPattern = /^Bearer ([A-Za-z0-9._~-]{20,8192})$/u;
const implementedStates = new Set(['beta', 'fixture_verified', 'implemented', 'verified']);

export const DESKTOP_ENTITLEMENT_FEATURE_IDS = Object.freeze(
  FEATURE_IDS.filter((featureId) => implementedStates.has(FEATURE_REGISTRY[featureId].state)),
);

export interface EntitlementSigningConfig {
  readonly keyId: string;
  /** Base64-encoded PKCS#8 DER Ed25519 private key. */
  readonly privateKey: string;
}

const decodePrivateKey = (encoded: string) => {
  const der = Buffer.from(encoded, 'base64');
  if (der.byteLength < 32 || der.byteLength > 4096)
    throw new Error('Desktop entitlement private key is invalid.');
  const key = createPrivateKey({ format: 'der', key: der, type: 'pkcs8' });
  if (key.asymmetricKeyType !== 'ed25519')
    throw new Error('Desktop entitlement signing requires an Ed25519 key.');
  return key;
};

export const signDesktopEntitlement = (
  payloadInput: DesktopEntitlementPayload,
  config: EntitlementSigningConfig,
): SignedDesktopEntitlement => {
  const payload = Buffer.from(
    JSON.stringify(desktopEntitlementPayloadSchema.parse(payloadInput)),
    'utf8',
  );
  return signedDesktopEntitlementSchema.parse({
    algorithm: 'Ed25519',
    keyId: config.keyId,
    payload: payload.toString('base64url'),
    signature: sign(null, payload, decodePrivateKey(config.privateKey)).toString('base64url'),
  });
};

export const parseDesktopBearerToken = (request: Request): string => {
  const authorization = request.headers.get('authorization');
  const match = authorization?.match(bearerPattern);
  if (match?.[1] === undefined)
    throw new ApiFault('AUTH_REQUIRED', 'Sign in to verify desktop access.', 401);
  return match[1];
};

const workspaceSchema = z.object({ id: z.uuid() });
const membershipSchema = z.object({ role: z.literal('owner'), status: z.literal('active') });
const entitlementSchema = z.object({
  effective_until: z.iso.datetime({ offset: true }).nullable(),
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
});

export const createSignedDesktopEntitlement = async (
  request: Request,
  now = new Date(),
): Promise<SignedDesktopEntitlement> => {
  const config = parseServerConfig(process.env);
  if (config.desktopEntitlements.signing === null || config.trustedSupabase === null) {
    throw new ApiFault(
      'PROVIDER_UNAVAILABLE',
      'Desktop access verification is not configured.',
      503,
      true,
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: userResult, error: userError } = await admin.auth.getUser(
    parseDesktopBearerToken(request),
  );
  const user = userResult.user;
  if (userError !== null || user === null)
    throw new ApiFault('AUTH_REQUIRED', 'Sign in to verify desktop access.', 401);
  if (user.email_confirmed_at === undefined)
    throw new ApiFault('EMAIL_VERIFICATION_REQUIRED', 'Verify your email to continue.', 403);

  const { data: workspaceData, error: workspaceError } = await admin
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', user.id)
    .eq('kind', 'personal')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (workspaceError !== null)
    throw new ApiFault('PROVIDER_UNAVAILABLE', 'Desktop access verification stopped safely.', 503);
  const workspace = workspaceSchema.nullable().parse(workspaceData);
  if (workspace === null)
    throw new ApiFault('ENTITLEMENT_REQUIRED', 'Desktop access is not available.', 403);

  const [membershipResult, entitlementResult] = await Promise.all([
    admin
      .from('workspace_members')
      .select('role,status')
      .eq('workspace_id', workspace.id)
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .eq('status', 'active')
      .maybeSingle(),
    admin
      .from('entitlement_snapshots')
      .select('enabled,effective_until,revision')
      .eq('workspace_id', workspace.id)
      .eq('feature_key', 'desktop.full')
      .maybeSingle(),
  ]);
  if (membershipResult.error !== null || entitlementResult.error !== null) {
    throw new ApiFault('PROVIDER_UNAVAILABLE', 'Desktop access verification stopped safely.', 503);
  }
  const membership = membershipSchema.nullable().parse(membershipResult.data);
  const entitlement = entitlementSchema.nullable().parse(entitlementResult.data);
  if (membership === null || entitlement === null)
    throw new ApiFault('ENTITLEMENT_REQUIRED', 'Desktop access is not available.', 403);

  const expiresAt = new Date(now.getTime() + config.desktopEntitlements.ttlHours * 60 * 60 * 1000);
  const effective =
    entitlement.enabled &&
    (entitlement.effective_until === null ||
      Date.parse(entitlement.effective_until) >= now.getTime());
  return signDesktopEntitlement(
    {
      audience: 'pdfmason-desktop',
      entitlement: {
        enabled: effective,
        featureKey: 'desktop.full',
        revision: entitlement.revision,
      },
      expiresAt: expiresAt.toISOString(),
      featureIds: [...DESKTOP_ENTITLEMENT_FEATURE_IDS],
      issuedAt: now.toISOString(),
      offlineGraceUntil: new Date(
        expiresAt.getTime() + config.desktopEntitlements.graceHours * 60 * 60 * 1000,
      ).toISOString(),
      userId: user.id,
      version: 1,
      workspaceId: workspace.id,
    },
    config.desktopEntitlements.signing,
  );
};

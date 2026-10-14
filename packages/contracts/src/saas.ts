import { z } from 'zod';

import { isFeatureId } from './feature-registry.js';

export const workspaceStatuses = ['active', 'suspended', 'deleting', 'deleted'] as const;
export type WorkspaceStatus = (typeof workspaceStatuses)[number];

export const cloudJobStates = [
  'awaiting_upload',
  'queued',
  'processing',
  'retry_wait',
  'cancelling',
  'cancelled',
  'completed',
  'failed',
  'expired',
  'deleting',
  'deleted',
  'deletion_attention',
] as const;
export type CloudJobState = (typeof cloudJobStates)[number];

export const cloudJobObjectStates = [
  'pending',
  'uploaded',
  'verified',
  'deleted',
  'delete_failed',
] as const;
export type CloudJobObjectState = (typeof cloudJobObjectStates)[number];

export const subscriptionStatuses = [
  'none',
  'trialing',
  'active',
  'past_due',
  'paused',
  'cancelled',
  'unpaid',
] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export const usageStatuses = ['reserved', 'consumed', 'released'] as const;
export type UsageStatus = (typeof usageStatuses)[number];

export const planKeys = ['free', 'pro_monthly', 'pro_annual'] as const;
export type PlanKey = (typeof planKeys)[number];

export const uuidSchema = z.uuid();
export const isoTimestampSchema = z.iso.datetime({ offset: true });
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const opaqueIdSchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/);
export const safeOperationSchema = z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/);
export const safeStageSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
export const featureKeySchema = z
  .string()
  .min(3)
  .max(100)
  .refine((value) => isFeatureId(value) || /^[a-z][a-z0-9]*(?:\.[a-z0-9_]+)+$/.test(value));

export const cloudPrincipalSchema = z.object({
  emailVerified: z.boolean(),
  userId: uuidSchema,
  workspaceId: uuidSchema,
});
export type CloudPrincipal = z.infer<typeof cloudPrincipalSchema>;

export const uploadAuthorizationRequestSchema = z.object({
  byteLength: z.number().int().positive().max(250_000_000),
  contentType: z.literal('application/pdf'),
  idempotencyKey: idempotencyKeySchema,
  operation: safeOperationSchema,
  operationVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  sha256: sha256Schema,
});
export type UploadAuthorizationRequest = z.infer<typeof uploadAuthorizationRequestSchema>;

export const objectGrantSchema = z.object({
  expiresAt: isoTimestampSchema,
  headers: z.record(z.string(), z.string()),
  method: z.enum(['GET', 'PUT']),
  objectId: opaqueIdSchema,
  url: z.url(),
});
export type ObjectGrant = z.infer<typeof objectGrantSchema>;

export const uploadAuthorizationResponseSchema = z.object({
  grant: objectGrantSchema,
  jobId: uuidSchema,
  retention: z.object({
    deleteAfter: isoTimestampSchema,
    explanation: z.string().min(1).max(240),
  }),
});
export type UploadAuthorizationResponse = z.infer<typeof uploadAuthorizationResponseSchema>;

export const uploadCompletionRequestSchema = z.object({
  byteLength: z.number().int().positive().max(250_000_000),
  sha256: sha256Schema,
});
export type UploadCompletionRequest = z.infer<typeof uploadCompletionRequestSchema>;

const forbiddenCloudOptionName =
  /(?:password|passphrase|secret|token|authorization|cookie|filename|documentText|pdfText)/iu;

export const createCloudJobRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  inputObjectId: opaqueIdSchema,
  operation: safeOperationSchema,
  operationVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  options: z.record(
    z
      .string()
      .max(80)
      .refine(
        (key) => !forbiddenCloudOptionName.test(key),
        'Sensitive option names are forbidden.',
      ),
    z.union([z.boolean(), z.number(), z.string().max(500), z.array(z.string().max(200)).max(100)]),
  ),
});
export type CreateCloudJobRequest = z.infer<typeof createCloudJobRequestSchema>;

export const safeCloudJobSchema = z.object({
  completedAt: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
  deleteAfter: isoTimestampSchema,
  errorCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .nullable(),
  id: uuidSchema,
  operation: safeOperationSchema,
  operationVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  progressStage: safeStageSchema,
  progressValue: z.number().int().min(0).max(100).nullable(),
  state: z.enum(cloudJobStates),
  warningCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
});
export type SafeCloudJob = z.infer<typeof safeCloudJobSchema>;

export const entitlementSnapshotSchema = z.object({
  effectiveUntil: isoTimestampSchema.nullable(),
  enabled: z.boolean(),
  featureKey: featureKeySchema,
  limitUnit: z.enum(['jobs', 'pages', 'bytes']).nullable(),
  limitValue: z.number().int().nonnegative().nullable(),
  revision: z.number().int().nonnegative(),
  usedValue: z.number().int().nonnegative(),
});
export type EntitlementSnapshot = z.infer<typeof entitlementSnapshotSchema>;

const priorityFeatureIdSchema = z.string().refine(isFeatureId, 'Unknown PDFMason feature ID');
const base64UrlSchema = z
  .string()
  .min(16)
  .max(32_768)
  .regex(/^[A-Za-z0-9_-]+$/);

export const desktopEntitlementPayloadSchema = z.object({
  audience: z.literal('pdfmason-desktop'),
  entitlement: z.object({
    enabled: z.boolean(),
    featureKey: z.literal('desktop.full'),
    revision: z.number().int().nonnegative(),
  }),
  expiresAt: isoTimestampSchema,
  featureIds: z.array(priorityFeatureIdSchema).max(200),
  issuedAt: isoTimestampSchema,
  offlineGraceUntil: isoTimestampSchema,
  userId: uuidSchema,
  version: z.literal(1),
  workspaceId: uuidSchema,
});
export type DesktopEntitlementPayload = z.infer<typeof desktopEntitlementPayloadSchema>;

export const signedDesktopEntitlementSchema = z.object({
  algorithm: z.literal('Ed25519'),
  keyId: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/),
  payload: base64UrlSchema,
  signature: base64UrlSchema,
});
export type SignedDesktopEntitlement = z.infer<typeof signedDesktopEntitlementSchema>;

export const desktopEntitlementCacheSchema = z.object({
  envelope: signedDesktopEntitlementSchema,
  lastObservedAt: isoTimestampSchema,
});
export type DesktopEntitlementCache = z.infer<typeof desktopEntitlementCacheSchema>;

export const billingCheckoutRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  planKey: z.enum(planKeys).exclude(['free']),
});
export type CreateBillingCheckoutRequest = z.infer<typeof billingCheckoutRequestSchema>;

export const billingRedirectSchema = z.object({
  expiresAt: isoTimestampSchema,
  url: z.url(),
});
export type BillingRedirect = z.infer<typeof billingRedirectSchema>;

export const privacyPreferencesSchema = z.object({
  retainJobHistory: z.boolean(),
});
export type PrivacyPreferences = z.infer<typeof privacyPreferencesSchema>;

export const apiErrorCodes = [
  'AUTH_REQUIRED',
  'EMAIL_VERIFICATION_REQUIRED',
  'ENTITLEMENT_REQUIRED',
  'INPUT_INVALID',
  'NOT_FOUND',
  'ORIGIN_REJECTED',
  'PROVIDER_UNAVAILABLE',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'STATE_CONFLICT',
  'WEBHOOK_INVALID',
] as const;
export type ApiErrorCode = (typeof apiErrorCodes)[number];

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(apiErrorCodes),
    details: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
    message: z.string().min(1),
    requestId: opaqueIdSchema,
    retryable: z.boolean(),
  }),
});
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

const transitionMap = Object.freeze({
  awaiting_upload: Object.freeze(['queued', 'expired', 'deleting']),
  queued: Object.freeze(['processing', 'cancelling', 'deleting']),
  processing: Object.freeze(['completed', 'retry_wait', 'failed', 'cancelling']),
  retry_wait: Object.freeze(['queued', 'cancelling', 'failed']),
  cancelling: Object.freeze(['cancelled', 'deleting']),
  cancelled: Object.freeze(['deleting']),
  completed: Object.freeze(['deleting']),
  failed: Object.freeze(['deleting']),
  expired: Object.freeze(['deleting']),
  deleting: Object.freeze(['deleted', 'deletion_attention']),
  deleted: Object.freeze([]),
  deletion_attention: Object.freeze(['deleting']),
} as const satisfies Readonly<Record<CloudJobState, readonly CloudJobState[]>>);

export const canTransitionCloudJob = (from: CloudJobState, to: CloudJobState): boolean =>
  transitionMap[from].includes(to as never);

export interface RetentionPolicy {
  readonly historyDays: number;
  readonly outputHours: number;
  readonly safetyNetHours: number;
}

export const retentionPolicySchema = z
  .object({
    historyDays: z.number().int().min(1).max(90),
    outputHours: z.number().int().min(1).max(24),
    safetyNetHours: z.number().int().min(1).max(24),
  })
  .refine((value) => value.outputHours <= value.safetyNetHours, {
    message: 'Output retention cannot exceed the storage lifecycle safety net.',
  });

export const calculateDeleteAfter = (startedAt: Date, retentionHours: number): string =>
  new Date(startedAt.getTime() + retentionHours * 60 * 60 * 1000).toISOString();

export interface ProviderWebhookEvent {
  readonly createdAt: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly provider: 'fake' | 'stripe';
  readonly subscription: {
    readonly cancelAtPeriodEnd: boolean;
    readonly currency: string;
    readonly currentPeriodEnd: string | null;
    readonly currentPeriodStart: string | null;
    readonly planKey: PlanKey;
    readonly providerCustomerId: string;
    readonly providerSubscriptionId: string | null;
    readonly status: SubscriptionStatus;
    readonly workspaceId: string;
  } | null;
}

export const isWebhookNewer = (
  incoming: Pick<ProviderWebhookEvent, 'createdAt' | 'eventId'>,
  current: Pick<ProviderWebhookEvent, 'createdAt' | 'eventId'> | null,
): boolean =>
  current === null ||
  incoming.createdAt > current.createdAt ||
  (incoming.createdAt === current.createdAt && incoming.eventId > current.eventId);

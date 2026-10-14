import { z } from 'zod';

import { isFeatureId, type FeatureId } from './feature-registry.js';
import { isoTimestampSchema, opaqueIdSchema, uuidSchema } from './saas.js';

const safeErrorCodeSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/u);
const applicationVersionSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[0-9A-Za-z.+-]+$/u);

export const betaFeatureIdSchema = z.custom<FeatureId>(
  (value) => typeof value === 'string' && isFeatureId(value),
  'Unknown PDFMason feature ID',
);

export const betaSurfaceSchema = z.enum([
  'account',
  'desktop',
  'help',
  'home',
  'known_limits',
  'policies',
  'pricing',
  'status',
  'support',
  'tools',
  'workspace',
]);
export type BetaSurface = z.infer<typeof betaSurfaceSchema>;

/**
 * Support starts with content-free diagnostics. There is deliberately no message,
 * filename, URL, attachment, or document-content field in this contract.
 */
export const betaSupportRequestSchema = z
  .object({
    applicationVersion: applicationVersionSchema,
    category: z.enum([
      'accessibility',
      'account',
      'billing',
      'cloud_job',
      'local_tool',
      'privacy',
      'windows',
    ]),
    consentToContact: z.literal(true),
    errorCode: safeErrorCodeSchema.optional(),
    platform: z.enum(['web', 'windows']),
    replyEmail: z.email().max(254),
    requestId: opaqueIdSchema.optional(),
  })
  .strict();
export type BetaSupportRequest = z.infer<typeof betaSupportRequestSchema>;

export const betaFeedbackRequestSchema = z
  .object({
    applicationVersion: applicationVersionSchema,
    consentToAggregate: z.literal(true),
    featureId: betaFeatureIdSchema.optional(),
    outcome: z.enum(['blocked', 'completed', 'confusing', 'not_started']),
    platform: z.enum(['web', 'windows']),
    rating: z.number().int().min(1).max(5),
  })
  .strict();
export type BetaFeedbackRequest = z.infer<typeof betaFeedbackRequestSchema>;

export const betaAnalyticsEventSchema = z
  .object({
    event: z.enum([
      'cloud_consent_viewed',
      'download_cta_selected',
      'feature_disabled',
      'local_tool_completed',
      'local_tool_started',
      'page_view',
      'pricing_viewed',
      'support_opened',
    ]),
    eventId: uuidSchema,
    featureId: betaFeatureIdSchema.optional(),
    occurredAt: isoTimestampSchema,
    outcome: z.enum(['cancelled', 'failure', 'success', 'unsupported']).optional(),
    surface: betaSurfaceSchema,
  })
  .strict();
export type BetaAnalyticsEvent = z.infer<typeof betaAnalyticsEventSchema>;

export const betaIntakeReceiptSchema = z.object({
  reference: z.string().regex(/^BETA-[A-F0-9]{12}$/u),
  receivedAt: isoTimestampSchema,
});
export type BetaIntakeReceipt = z.infer<typeof betaIntakeReceiptSchema>;

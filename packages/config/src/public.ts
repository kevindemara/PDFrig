import { z } from 'zod';

const applicationEnvironmentSchema = z.enum(['development', 'preview', 'staging', 'production']);
const approvalStatusSchema = z.enum(['development-draft', 'approved']);
const pricingStatusSchema = z.enum(['provisional', 'approved']);

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_APP_ENV: applicationEnvironmentSchema,
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_APP_VERSION: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[0-9A-Za-z.+-]+$/u),
  NEXT_PUBLIC_ANALYTICS_ENABLED: z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_BETA_INTAKE_ENABLED: z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_BRAND_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FEATURE_BLANK_ENABLED: z.enum(['true', 'false']).default('true'),
  NEXT_PUBLIC_FEATURE_COMPRESS_ENABLED: z.enum(['true', 'false']).default('true'),
  NEXT_PUBLIC_FEATURE_COMMENT_REVIEW_ENABLED: z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_DECORATE_ENABLED: z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_GEOMETRY_ENABLED: z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_IMAGES_ENABLED: z.enum(['true', 'false']).default('true'),
  NEXT_PUBLIC_FEATURE_METADATA_ENABLED: z.enum(['true', 'false']).default('true'),
  NEXT_PUBLIC_FEATURE_MEASUREMENT_ENABLED: z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_NUMBERING_ENABLED: z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_OCR_ENABLED: z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_PERMISSIONS_ENABLED: z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_PROTECT_ENABLED: z.enum(['true', 'false']).default('true'),
  NEXT_PUBLIC_FEATURE_REDACTION_ENABLED: z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_RENDER_ENABLED: z.enum(['true', 'false']).default('true'),
  NEXT_PUBLIC_FEATURE_STAMPS_ENABLED: z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_TEXT_ENABLED: z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_HISTORY_RETENTION_DAYS: z.coerce.number().int().min(1).max(90),
  NEXT_PUBLIC_LEGAL_ENTITY: z.string().min(1),
  NEXT_PUBLIC_PLAN_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/u)
    .default('CAD'),
  NEXT_PUBLIC_PLAN_PRO_ANNUAL_MINOR: z.coerce.number().int().positive().max(1_000_000),
  NEXT_PUBLIC_PLAN_PRO_MONTHLY_MINOR: z.coerce.number().int().positive().max(1_000_000),
  NEXT_PUBLIC_POLICY_EFFECTIVE_DATE: z.iso.date(),
  NEXT_PUBLIC_POLICY_STATUS: approvalStatusSchema,
  NEXT_PUBLIC_PRICING_STATUS: pricingStatusSchema,
  NEXT_PUBLIC_PRIVACY_CONTACT: z.email(),
  NEXT_PUBLIC_PROCESSING_LOCATION: z.string().min(2).max(120),
  NEXT_PUBLIC_REFUND_SUMMARY: z.string().min(20).max(500),
  NEXT_PUBLIC_STORAGE_SAFETY_NET_HOURS: z.coerce.number().int().min(1).max(24),
  NEXT_PUBLIC_STATUS_PAGE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPPORT_EMAIL: z.email(),
  NEXT_PUBLIC_TEMPORARY_OUTPUT_HOURS: z.coerce.number().int().min(1).max(24),
});

export interface PublicConfig {
  readonly applicationEnvironment: z.infer<typeof applicationEnvironmentSchema>;
  readonly applicationUrl: string;
  readonly applicationVersion: string;
  readonly auth: {
    readonly enabled: boolean;
    readonly publishableKey: string | null;
    readonly supabaseUrl: string | null;
  };
  readonly beta: {
    readonly analyticsEnabled: boolean;
    readonly intakeEnabled: boolean;
  };
  readonly brand: {
    readonly domain: string;
    readonly legalEntity: string;
    readonly name: 'PDFrig';
    readonly privacyContact: string;
    readonly supportEmail: string;
    readonly tagline: 'Build better PDFs.';
  };
  readonly commerce: {
    readonly currency: string;
    readonly pricingStatus: z.infer<typeof pricingStatusSchema>;
    readonly proAnnualMinor: number;
    readonly proMonthlyMinor: number;
    readonly refundSummary: string;
  };
  readonly policy: {
    readonly effectiveDate: string;
    readonly processingLocation: string;
    readonly retention: {
      readonly historyDays: number;
      readonly outputHours: number;
      readonly safetyNetHours: number;
    };
    readonly status: z.infer<typeof approvalStatusSchema>;
    readonly statusPageUrl: string | null;
  };
  readonly utilityFeatures: {
    readonly blank: boolean;
    readonly compress: boolean;
    readonly commentReview: boolean;
    readonly decorate: boolean;
    readonly geometry: boolean;
    readonly images: boolean;
    readonly metadata: boolean;
    readonly measurement: boolean;
    readonly number: boolean;
    readonly ocr: boolean;
    readonly permissions: boolean;
    readonly protect: boolean;
    readonly redaction: boolean;
    readonly render: boolean;
    readonly stamps: boolean;
    readonly text: boolean;
  };
}

const developmentDefaults = {
  NEXT_PUBLIC_APP_ENV: 'development',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_APP_VERSION: '0.0.0-local',
  NEXT_PUBLIC_ANALYTICS_ENABLED: 'true',
  NEXT_PUBLIC_BETA_INTAKE_ENABLED: 'true',
  NEXT_PUBLIC_BRAND_DOMAIN: 'localhost',
  NEXT_PUBLIC_FEATURE_BLANK_ENABLED: 'true',
  NEXT_PUBLIC_FEATURE_DECORATE_ENABLED: 'true',
  NEXT_PUBLIC_FEATURE_COMMENT_REVIEW_ENABLED: 'true',
  NEXT_PUBLIC_FEATURE_GEOMETRY_ENABLED: 'true',
  NEXT_PUBLIC_FEATURE_NUMBERING_ENABLED: 'true',
  NEXT_PUBLIC_FEATURE_MEASUREMENT_ENABLED: 'true',
  NEXT_PUBLIC_FEATURE_STAMPS_ENABLED: 'true',
  NEXT_PUBLIC_FEATURE_TEXT_ENABLED: 'true',
  NEXT_PUBLIC_LEGAL_ENTITY: 'PDFrig development',
  NEXT_PUBLIC_HISTORY_RETENTION_DAYS: '30',
  NEXT_PUBLIC_PLAN_CURRENCY: 'CAD',
  NEXT_PUBLIC_PLAN_PRO_ANNUAL_MINOR: '5999',
  NEXT_PUBLIC_PLAN_PRO_MONTHLY_MINOR: '699',
  NEXT_PUBLIC_POLICY_EFFECTIVE_DATE: '2026-08-24',
  NEXT_PUBLIC_POLICY_STATUS: 'development-draft',
  NEXT_PUBLIC_PRICING_STATUS: 'provisional',
  NEXT_PUBLIC_PRIVACY_CONTACT: 'privacy@example.invalid',
  NEXT_PUBLIC_PROCESSING_LOCATION: 'Local development only; production regions are not approved.',
  NEXT_PUBLIC_REFUND_SUMMARY:
    'Development placeholder: refund eligibility and required consumer-law disclosures need approval before payment is enabled.',
  NEXT_PUBLIC_STORAGE_SAFETY_NET_HOURS: '24',
  NEXT_PUBLIC_SUPPORT_EMAIL: 'support@example.invalid',
  NEXT_PUBLIC_TEMPORARY_OUTPUT_HOURS: '1',
} as const;

export const parsePublicConfig = (
  input: Readonly<Record<string, string | undefined>>,
): PublicConfig => {
  const environment = applicationEnvironmentSchema.parse(
    input.NEXT_PUBLIC_APP_ENV ?? developmentDefaults.NEXT_PUBLIC_APP_ENV,
  );
  const source =
    environment === 'production'
      ? { ...input, NEXT_PUBLIC_APP_ENV: environment }
      : {
          ...developmentDefaults,
          NEXT_PUBLIC_FEATURE_TEXT_ENABLED: environment === 'development' ? 'true' : 'false',
          NEXT_PUBLIC_FEATURE_PERMISSIONS_ENABLED: environment === 'development' ? 'true' : 'false',
          ...input,
          NEXT_PUBLIC_APP_ENV: environment,
        };
  const parsed = publicEnvironmentSchema.parse(source);
  if (
    environment === 'production' &&
    (parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === undefined ||
      parsed.NEXT_PUBLIC_SUPABASE_URL === undefined)
  ) {
    throw new Error('Production requires the Supabase URL and publishable key.');
  }
  if (
    environment === 'production' &&
    (parsed.NEXT_PUBLIC_POLICY_STATUS !== 'approved' ||
      parsed.NEXT_PUBLIC_PRICING_STATUS !== 'approved')
  ) {
    throw new Error('Production requires approved policy and pricing configuration.');
  }
  if (parsed.NEXT_PUBLIC_TEMPORARY_OUTPUT_HOURS > parsed.NEXT_PUBLIC_STORAGE_SAFETY_NET_HOURS) {
    throw new Error('Public output retention cannot exceed the storage safety net.');
  }

  return Object.freeze({
    applicationEnvironment: parsed.NEXT_PUBLIC_APP_ENV,
    applicationUrl: parsed.NEXT_PUBLIC_APP_URL,
    applicationVersion: parsed.NEXT_PUBLIC_APP_VERSION,
    auth: Object.freeze({
      enabled:
        parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== undefined &&
        parsed.NEXT_PUBLIC_SUPABASE_URL !== undefined,
      publishableKey: parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? null,
      supabaseUrl: parsed.NEXT_PUBLIC_SUPABASE_URL ?? null,
    }),
    beta: Object.freeze({
      analyticsEnabled: parsed.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true',
      intakeEnabled: parsed.NEXT_PUBLIC_BETA_INTAKE_ENABLED === 'true',
    }),
    brand: Object.freeze({
      domain: parsed.NEXT_PUBLIC_BRAND_DOMAIN,
      legalEntity: parsed.NEXT_PUBLIC_LEGAL_ENTITY,
      name: 'PDFrig',
      privacyContact: parsed.NEXT_PUBLIC_PRIVACY_CONTACT,
      supportEmail: parsed.NEXT_PUBLIC_SUPPORT_EMAIL,
      tagline: 'Build better PDFs.',
    }),
    commerce: Object.freeze({
      currency: parsed.NEXT_PUBLIC_PLAN_CURRENCY,
      pricingStatus: parsed.NEXT_PUBLIC_PRICING_STATUS,
      proAnnualMinor: parsed.NEXT_PUBLIC_PLAN_PRO_ANNUAL_MINOR,
      proMonthlyMinor: parsed.NEXT_PUBLIC_PLAN_PRO_MONTHLY_MINOR,
      refundSummary: parsed.NEXT_PUBLIC_REFUND_SUMMARY,
    }),
    policy: Object.freeze({
      effectiveDate: parsed.NEXT_PUBLIC_POLICY_EFFECTIVE_DATE,
      processingLocation: parsed.NEXT_PUBLIC_PROCESSING_LOCATION,
      retention: Object.freeze({
        historyDays: parsed.NEXT_PUBLIC_HISTORY_RETENTION_DAYS,
        outputHours: parsed.NEXT_PUBLIC_TEMPORARY_OUTPUT_HOURS,
        safetyNetHours: parsed.NEXT_PUBLIC_STORAGE_SAFETY_NET_HOURS,
      }),
      status: parsed.NEXT_PUBLIC_POLICY_STATUS,
      statusPageUrl: parsed.NEXT_PUBLIC_STATUS_PAGE_URL ?? null,
    }),
    utilityFeatures: Object.freeze({
      blank: parsed.NEXT_PUBLIC_FEATURE_BLANK_ENABLED === 'true',
      compress: parsed.NEXT_PUBLIC_FEATURE_COMPRESS_ENABLED === 'true',
      commentReview: parsed.NEXT_PUBLIC_FEATURE_COMMENT_REVIEW_ENABLED === 'true',
      decorate: parsed.NEXT_PUBLIC_FEATURE_DECORATE_ENABLED === 'true',
      geometry: parsed.NEXT_PUBLIC_FEATURE_GEOMETRY_ENABLED === 'true',
      images: parsed.NEXT_PUBLIC_FEATURE_IMAGES_ENABLED === 'true',
      metadata: parsed.NEXT_PUBLIC_FEATURE_METADATA_ENABLED === 'true',
      measurement: parsed.NEXT_PUBLIC_FEATURE_MEASUREMENT_ENABLED === 'true',
      number: parsed.NEXT_PUBLIC_FEATURE_NUMBERING_ENABLED === 'true',
      ocr: parsed.NEXT_PUBLIC_FEATURE_OCR_ENABLED === 'true',
      permissions: parsed.NEXT_PUBLIC_FEATURE_PERMISSIONS_ENABLED === 'true',
      protect: parsed.NEXT_PUBLIC_FEATURE_PROTECT_ENABLED === 'true',
      redaction: parsed.NEXT_PUBLIC_FEATURE_REDACTION_ENABLED === 'true',
      render: parsed.NEXT_PUBLIC_FEATURE_RENDER_ENABLED === 'true',
      stamps: parsed.NEXT_PUBLIC_FEATURE_STAMPS_ENABLED === 'true',
      text: parsed.NEXT_PUBLIC_FEATURE_TEXT_ENABLED === 'true',
    }),
  });
};

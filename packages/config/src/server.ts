import { z } from 'zod';

const providerModeSchema = z.enum(['fake', 'production']);
const betaServiceModeSchema = z.enum(['disabled', 'fake']);
const applicationEnvironmentSchema = z.enum(['development', 'preview', 'staging', 'production']);

const serverEnvironmentSchema = z.object({
  NEXT_PUBLIC_APP_ENV: applicationEnvironmentSchema.default('development'),
  PDFMASON_ANALYTICS_MODE: betaServiceModeSchema.optional(),
  PDFMASON_ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:3000,http://localhost:3000'),
  PDFMASON_BETA_INTAKE_MODE: betaServiceModeSchema.optional(),
  PDFMASON_DESKTOP_ENTITLEMENT_GRACE_HOURS: z.coerce.number().int().min(0).max(168).default(168),
  PDFMASON_DESKTOP_ENTITLEMENT_KEY_ID: z
    .string()
    .regex(/^[A-Za-z0-9._-]{3,64}$/)
    .optional(),
  PDFMASON_DESKTOP_ENTITLEMENT_PRIVATE_KEY: z.string().min(40).optional(),
  PDFMASON_DESKTOP_ENTITLEMENT_TTL_HOURS: z.coerce.number().int().min(1).max(48).default(24),
  PDFMASON_HISTORY_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  PDFMASON_OFFICE_CONVERSION_ENABLED: z.enum(['true', 'false']).default('false'),
  PDFMASON_OFFICE_EXPANDED_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(10_000_000)
    .max(1_000_000_000)
    .default(250_000_000),
  PDFMASON_OFFICE_INPUT_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1_000_000)
    .max(100_000_000)
    .default(50_000_000),
  PDFMASON_OFFICE_JOB_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(600).default(120),
  PDFMASON_OFFICE_OUTPUT_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1_000_000)
    .max(1_000_000_000)
    .default(200_000_000),
  PDFMASON_OCR_ENABLED: z.enum(['true', 'false']).default('false'),
  PDFMASON_OCR_INPUT_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1_000_000)
    .max(100_000_000)
    .default(50_000_000),
  PDFMASON_OCR_LANGUAGES: z.string().default('eng,fra'),
  PDFMASON_OCR_MAXIMUM_PAGES: z.coerce.number().int().min(1).max(100).default(50),
  PDFMASON_OCR_MAXIMUM_PIXELS: z.coerce
    .number()
    .int()
    .min(1_000_000)
    .max(200_000_000)
    .default(20_000_000),
  PDFMASON_OCR_OUTPUT_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1_000_000)
    .max(500_000_000)
    .default(200_000_000),
  PDFMASON_OCR_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(900).default(180),
  PDFMASON_OUTPUT_RETENTION_HOURS: z.coerce.number().int().min(1).max(24).default(1),
  PDFMASON_PROCESSING_REGION: z.string().min(2).default('local-development'),
  PDFMASON_PROVIDER_MODE: providerModeSchema.default('fake'),
  PDFMASON_R2_ACCESS_KEY_ID: z.string().min(12).optional(),
  PDFMASON_R2_ACCOUNT_ID: z.string().min(12).optional(),
  PDFMASON_R2_BUCKET: z.string().min(3).optional(),
  PDFMASON_R2_SECRET_ACCESS_KEY: z.string().min(20).optional(),
  PDFMASON_STORAGE_GRANT_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
  PDFMASON_STORAGE_SAFETY_NET_HOURS: z.coerce.number().int().min(1).max(24).default(24),
  PDFMASON_STRIPE_PRICE_PRO_ANNUAL: z.string().startsWith('price_').optional(),
  PDFMASON_STRIPE_PRICE_PRO_MONTHLY: z.string().startsWith('price_').optional(),
  PDFMASON_STRIPE_RESTRICTED_KEY: z
    .string()
    .regex(/^(?:rk|sk)_(?:test|live)_/)
    .optional(),
  PDFMASON_STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
  SUPABASE_SECRET_KEY: z.string().min(20).optional(),
  SUPABASE_URL: z.url().optional(),
  WORKER_HOST: z.string().min(3).default('127.0.0.1'),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(15).max(900).default(60),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  WORKER_PORT: z.coerce.number().int().min(1024).max(65_535).default(8787),
});

export interface ServerConfig {
  readonly applicationEnvironment: z.infer<typeof applicationEnvironmentSchema>;
  readonly allowedOrigins: readonly string[];
  readonly betaServices: {
    readonly analytics: z.infer<typeof betaServiceModeSchema>;
    readonly intake: z.infer<typeof betaServiceModeSchema>;
  };
  readonly desktopEntitlements: {
    readonly graceHours: number;
    readonly signing: {
      readonly keyId: string;
      readonly privateKey: string;
    } | null;
    readonly ttlHours: number;
  };
  readonly processingRegion: string;
  readonly providerMode: z.infer<typeof providerModeSchema>;
  readonly retention: {
    readonly historyDays: number;
    readonly outputHours: number;
    readonly safetyNetHours: number;
  };
  readonly storageGrantSeconds: number;
  readonly trustedSupabase: {
    readonly secretKey: string;
    readonly url: string;
  } | null;
  readonly utilityFeatures: {
    readonly officeConversion: {
      readonly enabled: boolean;
      readonly expandedLimitBytes: number;
      readonly inputLimitBytes: number;
      readonly outputLimitBytes: number;
      readonly timeoutSeconds: number;
    };
    readonly ocr: {
      readonly enabled: boolean;
      readonly inputLimitBytes: number;
      readonly languages: readonly string[];
      readonly maximumPages: number;
      readonly maximumPixels: number;
      readonly outputLimitBytes: number;
      readonly timeoutSeconds: number;
    };
  };
  readonly workerPort: number;
  readonly worker: {
    readonly host: string;
    readonly leaseSeconds: number;
    readonly pollIntervalMs: number;
  };
  readonly production: {
    readonly r2: {
      readonly accessKeyId: string;
      readonly accountId: string;
      readonly bucket: string;
      readonly secretAccessKey: string;
    };
    readonly stripe: {
      readonly priceByPlan: {
        readonly pro_annual: string;
        readonly pro_monthly: string;
      };
      readonly restrictedKey: string;
      readonly webhookSecret: string;
    };
    readonly supabaseSecretKey: string;
    readonly supabaseUrl: string;
  } | null;
}

const splitOrigins = (value: string): readonly string[] =>
  Object.freeze(
    value
      .split(',')
      .map((origin) => new URL(origin.trim()).origin)
      .filter((origin, index, origins) => origins.indexOf(origin) === index),
  );

const splitOcrLanguages = (value: string): readonly string[] => {
  const languages = value
    .split(',')
    .map((language) => language.trim())
    .filter(
      (language, index, all) => /^[a-z]{3}$/u.test(language) && all.indexOf(language) === index,
    );
  if (languages.length === 0) throw new Error('At least one safe OCR language is required.');
  return Object.freeze(languages);
};

export const parseServerConfig = (
  input: Readonly<Record<string, string | undefined>>,
): ServerConfig => {
  const parsed = serverEnvironmentSchema.parse(input);
  const allowedOrigins = splitOrigins(parsed.PDFMASON_ALLOWED_ORIGINS);
  const analyticsMode =
    parsed.PDFMASON_ANALYTICS_MODE ??
    (parsed.NEXT_PUBLIC_APP_ENV === 'development' ? 'fake' : 'disabled');
  const intakeMode =
    parsed.PDFMASON_BETA_INTAKE_MODE ??
    (parsed.NEXT_PUBLIC_APP_ENV === 'development' ? 'fake' : 'disabled');
  const ocrLanguages = splitOcrLanguages(parsed.PDFMASON_OCR_LANGUAGES);
  if (allowedOrigins.length === 0)
    throw new Error('At least one allowed application origin is required.');
  if (parsed.PDFMASON_OUTPUT_RETENTION_HOURS > parsed.PDFMASON_STORAGE_SAFETY_NET_HOURS) {
    throw new Error('Output retention cannot exceed the storage lifecycle safety net.');
  }
  if (
    (parsed.PDFMASON_DESKTOP_ENTITLEMENT_KEY_ID === undefined) !==
    (parsed.PDFMASON_DESKTOP_ENTITLEMENT_PRIVATE_KEY === undefined)
  ) {
    throw new Error('Desktop entitlement signing requires both the key ID and private key.');
  }
  if ((parsed.SUPABASE_URL === undefined) !== (parsed.SUPABASE_SECRET_KEY === undefined)) {
    throw new Error('Trusted Supabase access requires both the URL and secret key.');
  }
  if (
    parsed.NEXT_PUBLIC_APP_ENV === 'production' &&
    parsed.PDFMASON_PROVIDER_MODE !== 'production'
  ) {
    throw new Error('Production cannot run with fake providers.');
  }
  if (
    parsed.NEXT_PUBLIC_APP_ENV === 'production' &&
    (analyticsMode === 'fake' || intakeMode === 'fake')
  ) {
    throw new Error('Production cannot run with fake beta intake or analytics services.');
  }

  const requireProductionValue = (value: string | undefined): string => {
    if (value === undefined) {
      throw new Error(
        'Production provider mode requires complete Supabase, Stripe, and R2 configuration.',
      );
    }
    return value;
  };

  const production =
    parsed.PDFMASON_PROVIDER_MODE === 'production'
      ? {
          r2: {
            accessKeyId: requireProductionValue(parsed.PDFMASON_R2_ACCESS_KEY_ID),
            accountId: requireProductionValue(parsed.PDFMASON_R2_ACCOUNT_ID),
            bucket: requireProductionValue(parsed.PDFMASON_R2_BUCKET),
            secretAccessKey: requireProductionValue(parsed.PDFMASON_R2_SECRET_ACCESS_KEY),
          },
          stripe: {
            priceByPlan: {
              pro_annual: requireProductionValue(parsed.PDFMASON_STRIPE_PRICE_PRO_ANNUAL),
              pro_monthly: requireProductionValue(parsed.PDFMASON_STRIPE_PRICE_PRO_MONTHLY),
            },
            restrictedKey: requireProductionValue(parsed.PDFMASON_STRIPE_RESTRICTED_KEY),
            webhookSecret: requireProductionValue(parsed.PDFMASON_STRIPE_WEBHOOK_SECRET),
          },
          supabaseSecretKey: requireProductionValue(parsed.SUPABASE_SECRET_KEY),
          supabaseUrl: requireProductionValue(parsed.SUPABASE_URL),
        }
      : null;
  const trustedSupabase =
    parsed.SUPABASE_URL === undefined || parsed.SUPABASE_SECRET_KEY === undefined
      ? null
      : Object.freeze({
          secretKey: parsed.SUPABASE_SECRET_KEY,
          url: parsed.SUPABASE_URL,
        });

  return Object.freeze({
    allowedOrigins,
    applicationEnvironment: parsed.NEXT_PUBLIC_APP_ENV,
    betaServices: Object.freeze({ analytics: analyticsMode, intake: intakeMode }),
    desktopEntitlements: Object.freeze({
      graceHours: parsed.PDFMASON_DESKTOP_ENTITLEMENT_GRACE_HOURS,
      signing:
        parsed.PDFMASON_DESKTOP_ENTITLEMENT_KEY_ID === undefined ||
        parsed.PDFMASON_DESKTOP_ENTITLEMENT_PRIVATE_KEY === undefined
          ? null
          : Object.freeze({
              keyId: parsed.PDFMASON_DESKTOP_ENTITLEMENT_KEY_ID,
              privateKey: parsed.PDFMASON_DESKTOP_ENTITLEMENT_PRIVATE_KEY,
            }),
      ttlHours: parsed.PDFMASON_DESKTOP_ENTITLEMENT_TTL_HOURS,
    }),
    processingRegion: parsed.PDFMASON_PROCESSING_REGION,
    production: production === null ? null : Object.freeze(production),
    providerMode: parsed.PDFMASON_PROVIDER_MODE,
    retention: Object.freeze({
      historyDays: parsed.PDFMASON_HISTORY_RETENTION_DAYS,
      outputHours: parsed.PDFMASON_OUTPUT_RETENTION_HOURS,
      safetyNetHours: parsed.PDFMASON_STORAGE_SAFETY_NET_HOURS,
    }),
    storageGrantSeconds: parsed.PDFMASON_STORAGE_GRANT_SECONDS,
    trustedSupabase,
    utilityFeatures: Object.freeze({
      officeConversion: Object.freeze({
        enabled: parsed.PDFMASON_OFFICE_CONVERSION_ENABLED === 'true',
        expandedLimitBytes: parsed.PDFMASON_OFFICE_EXPANDED_LIMIT_BYTES,
        inputLimitBytes: parsed.PDFMASON_OFFICE_INPUT_LIMIT_BYTES,
        outputLimitBytes: parsed.PDFMASON_OFFICE_OUTPUT_LIMIT_BYTES,
        timeoutSeconds: parsed.PDFMASON_OFFICE_JOB_TIMEOUT_SECONDS,
      }),
      ocr: Object.freeze({
        enabled: parsed.PDFMASON_OCR_ENABLED === 'true',
        inputLimitBytes: parsed.PDFMASON_OCR_INPUT_LIMIT_BYTES,
        languages: ocrLanguages,
        maximumPages: parsed.PDFMASON_OCR_MAXIMUM_PAGES,
        maximumPixels: parsed.PDFMASON_OCR_MAXIMUM_PIXELS,
        outputLimitBytes: parsed.PDFMASON_OCR_OUTPUT_LIMIT_BYTES,
        timeoutSeconds: parsed.PDFMASON_OCR_TIMEOUT_SECONDS,
      }),
    }),
    workerPort: parsed.WORKER_PORT,
    worker: Object.freeze({
      host: parsed.WORKER_HOST,
      leaseSeconds: parsed.WORKER_LEASE_SECONDS,
      pollIntervalMs: parsed.WORKER_POLL_INTERVAL_MS,
    }),
  });
};

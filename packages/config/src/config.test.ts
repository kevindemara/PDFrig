import { describe, expect, it } from 'vitest';

import { parsePublicConfig } from './public.js';
import { parseServerConfig } from './server.js';

describe('environment validation', () => {
  it('keeps SEC-003 permission controls development-only unless explicitly enabled', () => {
    expect(parsePublicConfig({}).utilityFeatures.permissions).toBe(true);
    for (const environment of ['preview', 'staging'])
      expect(
        parsePublicConfig({ NEXT_PUBLIC_APP_ENV: environment }).utilityFeatures.permissions,
      ).toBe(false);
    expect(
      parsePublicConfig({ NEXT_PUBLIC_FEATURE_PERMISSIONS_ENABLED: 'false' }).utilityFeatures
        .permissions,
    ).toBe(false);
    expect(() => parsePublicConfig({ NEXT_PUBLIC_FEATURE_PERMISSIONS_ENABLED: 'yes' })).toThrow();
  });
  it('honors the CONV-005 kill switch and rejects malformed flags', () => {
    for (const environment of ['preview', 'staging'])
      expect(parsePublicConfig({ NEXT_PUBLIC_APP_ENV: environment }).utilityFeatures.text).toBe(
        false,
      );
    expect(
      parsePublicConfig({ NEXT_PUBLIC_FEATURE_TEXT_ENABLED: 'false' }).utilityFeatures.text,
    ).toBe(false);
    expect(() => parsePublicConfig({ NEXT_PUBLIC_FEATURE_TEXT_ENABLED: 'yes' })).toThrow();
  });
  it('defaults SEC-003 off in a synthetically approved production configuration', () => {
    const production = {
      NEXT_PUBLIC_APP_ENV: 'production',
      NEXT_PUBLIC_APP_URL: 'https://pdfmason.example',
      NEXT_PUBLIC_APP_VERSION: '1.0.0',
      NEXT_PUBLIC_BRAND_DOMAIN: 'pdfmason.example',
      NEXT_PUBLIC_HISTORY_RETENTION_DAYS: '30',
      NEXT_PUBLIC_LEGAL_ENTITY: 'Synthetic entity',
      NEXT_PUBLIC_PLAN_PRO_ANNUAL_MINOR: '5999',
      NEXT_PUBLIC_PLAN_PRO_MONTHLY_MINOR: '699',
      NEXT_PUBLIC_POLICY_EFFECTIVE_DATE: '2026-10-03',
      NEXT_PUBLIC_POLICY_STATUS: 'approved',
      NEXT_PUBLIC_PRICING_STATUS: 'approved',
      NEXT_PUBLIC_PRIVACY_CONTACT: 'privacy@pdfmason.example',
      NEXT_PUBLIC_PROCESSING_LOCATION: 'Synthetic test region',
      NEXT_PUBLIC_REFUND_SUMMARY:
        'Synthetic configuration only, not a real approved refund policy.',
      NEXT_PUBLIC_STORAGE_SAFETY_NET_HOURS: '24',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_value',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPPORT_EMAIL: 'support@pdfmason.example',
      NEXT_PUBLIC_TEMPORARY_OUTPUT_HOURS: '1',
    };
    expect(parsePublicConfig(production).utilityFeatures.permissions).toBe(false);
    expect(
      parsePublicConfig({ ...production, NEXT_PUBLIC_FEATURE_PERMISSIONS_ENABLED: 'true' })
        .utilityFeatures.permissions,
    ).toBe(true);
  });
  it('uses centralized, safe development brand placeholders', () => {
    const config = parsePublicConfig({});
    expect(config.brand).toEqual({
      domain: 'localhost',
      legalEntity: 'PDFrig development',
      name: 'PDFrig',
      privacyContact: 'privacy@example.invalid',
      supportEmail: 'support@example.invalid',
      tagline: 'Build better PDFs.',
    });
    expect(config.auth).toEqual({ enabled: false, publishableKey: null, supabaseUrl: null });
    expect(config.beta).toEqual({ analyticsEnabled: true, intakeEnabled: true });
    expect(config.commerce).toMatchObject({
      currency: 'CAD',
      pricingStatus: 'provisional',
      proAnnualMinor: 5999,
      proMonthlyMinor: 699,
    });
    expect(config.policy).toMatchObject({
      status: 'development-draft',
      statusPageUrl: null,
    });
    expect(config.utilityFeatures).toEqual({
      tables: true,
      blank: true,
      compress: true,
      commentReview: true,
      decorate: true,
      geometry: true,
      images: true,
      metadata: true,
      measurement: true,
      number: true,
      ocr: false,
      permissions: true,
      protect: true,
      redaction: false,
      render: true,
      stamps: true,
      text: true,
    });
  });

  it('does not allow development placeholders in production', () => {
    expect(() => parsePublicConfig({ NEXT_PUBLIC_APP_ENV: 'production' })).toThrow();
  });

  it('validates the ANNO-008 kill switch and honors explicit disabling', () => {
    expect(
      parsePublicConfig({ NEXT_PUBLIC_FEATURE_MEASUREMENT_ENABLED: 'false' }).utilityFeatures
        .measurement,
    ).toBe(false);
    expect(() => parsePublicConfig({ NEXT_PUBLIC_FEATURE_MEASUREMENT_ENABLED: 'yes' })).toThrow();
  });

  it('rejects incomplete production provider configuration', () => {
    expect(() => parseServerConfig({ PDFMASON_PROVIDER_MODE: 'production' })).toThrow();
  });

  it('keeps trusted Supabase and entitlement signing explicitly paired', () => {
    expect(() => parseServerConfig({ SUPABASE_URL: 'http://127.0.0.1:54321' })).toThrow(
      'both the URL and secret key',
    );
    expect(() => parseServerConfig({ PDFMASON_DESKTOP_ENTITLEMENT_KEY_ID: 'local-key' })).toThrow(
      'both the key ID and private key',
    );
    const config = parseServerConfig({
      PDFMASON_DESKTOP_ENTITLEMENT_GRACE_HOURS: '24',
      PDFMASON_DESKTOP_ENTITLEMENT_KEY_ID: 'local-key',
      PDFMASON_DESKTOP_ENTITLEMENT_PRIVATE_KEY:
        'synthetic-private-key-material-that-is-not-a-real-secret',
      PDFMASON_DESKTOP_ENTITLEMENT_TTL_HOURS: '12',
      SUPABASE_SECRET_KEY: 'synthetic-secret-key-material',
      SUPABASE_URL: 'http://127.0.0.1:54321',
    });
    expect(config.desktopEntitlements).toMatchObject({
      graceHours: 24,
      signing: { keyId: 'local-key' },
      ttlHours: 12,
    });
    expect(config.trustedSupabase?.url).toBe('http://127.0.0.1:54321');
  });

  it('forbids fake providers in the production application environment', () => {
    expect(() =>
      parseServerConfig({ NEXT_PUBLIC_APP_ENV: 'production', PDFMASON_PROVIDER_MODE: 'fake' }),
    ).toThrow('Production cannot run with fake providers.');
  });

  it('keeps beta intake and analytics fake-only outside production', () => {
    expect(parseServerConfig({}).betaServices).toEqual({ analytics: 'fake', intake: 'fake' });
    expect(parseServerConfig({ NEXT_PUBLIC_APP_ENV: 'staging' }).betaServices).toEqual({
      analytics: 'disabled',
      intake: 'disabled',
    });
    expect(() =>
      parseServerConfig({
        NEXT_PUBLIC_APP_ENV: 'production',
        PDFMASON_ANALYTICS_MODE: 'fake',
        PDFMASON_PROVIDER_MODE: 'production',
      }),
    ).toThrow();
  });

  it('requires approved policy and pricing settings for a production public surface', () => {
    expect(() =>
      parsePublicConfig({
        NEXT_PUBLIC_APP_ENV: 'production',
        NEXT_PUBLIC_APP_URL: 'https://pdfmason.example',
        NEXT_PUBLIC_APP_VERSION: '1.0.0',
        NEXT_PUBLIC_BRAND_DOMAIN: 'pdfmason.example',
        NEXT_PUBLIC_HISTORY_RETENTION_DAYS: '30',
        NEXT_PUBLIC_LEGAL_ENTITY: 'Example legal entity',
        NEXT_PUBLIC_PLAN_PRO_ANNUAL_MINOR: '5999',
        NEXT_PUBLIC_PLAN_PRO_MONTHLY_MINOR: '699',
        NEXT_PUBLIC_POLICY_EFFECTIVE_DATE: '2026-08-24',
        NEXT_PUBLIC_POLICY_STATUS: 'development-draft',
        NEXT_PUBLIC_PRICING_STATUS: 'provisional',
        NEXT_PUBLIC_PRIVACY_CONTACT: 'privacy@pdfmason.example',
        NEXT_PUBLIC_PROCESSING_LOCATION: 'Configuration pending approval',
        NEXT_PUBLIC_REFUND_SUMMARY: 'A reviewed production refund policy will be supplied here.',
        NEXT_PUBLIC_STORAGE_SAFETY_NET_HOURS: '24',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_value',
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPPORT_EMAIL: 'support@pdfmason.example',
        NEXT_PUBLIC_TEMPORARY_OUTPUT_HOURS: '1',
      }),
    ).toThrow('approved policy and pricing');
  });

  it('validates retention and normalizes the trusted origin allowlist', () => {
    const config = parseServerConfig({
      PDFMASON_ALLOWED_ORIGINS: 'http://127.0.0.1:3000/path,http://127.0.0.1:3000',
    });
    expect(config.allowedOrigins).toEqual(['http://127.0.0.1:3000']);
    expect(config.retention).toEqual({ historyDays: 30, outputHours: 1, safetyNetHours: 24 });
    expect(config.utilityFeatures.officeConversion.enabled).toBe(false);
    expect(() =>
      parseServerConfig({
        PDFMASON_OUTPUT_RETENTION_HOURS: '24',
        PDFMASON_STORAGE_SAFETY_NET_HOURS: '1',
      }),
    ).toThrow('Output retention cannot exceed');
  });

  it('keeps Office conversion behind an explicit typed kill switch and resource limits', () => {
    const config = parseServerConfig({
      PDFMASON_OFFICE_CONVERSION_ENABLED: 'true',
      PDFMASON_OFFICE_EXPANDED_LIMIT_BYTES: '125000000',
      PDFMASON_OFFICE_INPUT_LIMIT_BYTES: '25000000',
      PDFMASON_OFFICE_JOB_TIMEOUT_SECONDS: '90',
      PDFMASON_OFFICE_OUTPUT_LIMIT_BYTES: '75000000',
    });
    expect(config.utilityFeatures.officeConversion).toEqual({
      enabled: true,
      expandedLimitBytes: 125_000_000,
      inputLimitBytes: 25_000_000,
      outputLimitBytes: 75_000_000,
      timeoutSeconds: 90,
    });
  });

  it('keeps Milestone 5 capabilities behind independent kill switches and bounds', () => {
    const publicConfig = parsePublicConfig({
      NEXT_PUBLIC_FEATURE_OCR_ENABLED: 'true',
      NEXT_PUBLIC_FEATURE_REDACTION_ENABLED: 'true',
    });
    expect(publicConfig.utilityFeatures.ocr).toBe(true);
    expect(publicConfig.utilityFeatures.redaction).toBe(true);
    const serverConfig = parseServerConfig({
      PDFMASON_OCR_ENABLED: 'true',
      PDFMASON_OCR_INPUT_LIMIT_BYTES: '25000000',
      PDFMASON_OCR_LANGUAGES: 'eng,fra,eng',
      PDFMASON_OCR_MAXIMUM_PAGES: '30',
      PDFMASON_OCR_MAXIMUM_PIXELS: '12000000',
      PDFMASON_OCR_OUTPUT_LIMIT_BYTES: '75000000',
      PDFMASON_OCR_TIMEOUT_SECONDS: '90',
    });
    expect(serverConfig.utilityFeatures.ocr).toEqual({
      enabled: true,
      inputLimitBytes: 25_000_000,
      languages: ['eng', 'fra'],
      maximumPages: 30,
      maximumPixels: 12_000_000,
      outputLimitBytes: 75_000_000,
      timeoutSeconds: 90,
    });
    expect(() => parseServerConfig({ PDFMASON_OCR_LANGUAGES: 'English' })).toThrow(
      'safe OCR language',
    );
  });
});

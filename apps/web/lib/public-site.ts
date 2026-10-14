import 'server-only';

import { parsePublicConfig } from '@pdfmason/config/public';
import type { PublicSiteFooterProps, PublicSiteLinks } from '@pdfmason/ui';

export const PUBLIC_SITE_LINKS: PublicSiteLinks = Object.freeze({
  account: '/account',
  help: '/help',
  home: '/',
  knownLimits: '/known-limitations',
  pricing: '/pricing',
  privacy: '/privacy',
  refunds: '/refunds',
  retention: '/retention',
  security: '/security',
  status: '/status',
  subprocessors: '/subprocessors',
  support: '/support',
  terms: '/terms',
  tools: '/tools',
  workspace: '/workspace',
});

export const getPublicSite = (): {
  readonly config: ReturnType<typeof parsePublicConfig>;
  readonly footer: Omit<PublicSiteFooterProps, 'links'>;
  readonly links: PublicSiteLinks;
} => {
  const config = parsePublicConfig(process.env);
  return Object.freeze({
    config,
    footer: Object.freeze({
      legalEntity: config.brand.legalEntity,
      policyStatus: config.policy.status,
      supportEmail: config.brand.supportEmail,
    }),
    links: PUBLIC_SITE_LINKS,
  });
};

export const formatPlanAmount = (minorUnits: number, currency: string): string =>
  new Intl.NumberFormat('en-CA', {
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(minorUnits / 100);

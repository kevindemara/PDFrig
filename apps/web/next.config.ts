import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

const securityHeaders = [
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
] as const;

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    '@pdfmason/config',
    '@pdfmason/contracts',
    '@pdfmason/editor-core',
    '@pdfmason/pdf-engine',
    '@pdfmason/ui',
  ],
  headers() {
    return Promise.resolve([{ headers: [...securityHeaders], source: '/(.*)' }]);
  },
};

export default (phase: string): NextConfig => {
  const isolation = process.env.PDFMASON_BROWSER_TEST_ISOLATION;
  if (isolation === undefined) return nextConfig;
  if (isolation !== '1' || phase !== PHASE_DEVELOPMENT_SERVER)
    throw new Error('Browser test isolation is valid only for the dedicated development server.');
  return {
    ...nextConfig,
    distDir: '.next-qa',
    typescript: { tsconfigPath: 'tsconfig.qa.json' },
  };
};

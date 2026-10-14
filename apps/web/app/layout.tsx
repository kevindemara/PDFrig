import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { parsePublicConfig } from '@pdfmason/config/public';
import '@pdfmason/ui/styles.css';

import { BetaAnalytics } from './beta-analytics';

const publicConfig = parsePublicConfig(process.env);

export const metadata: Metadata = {
  description: 'A straightforward, privacy-forward workspace for building better PDFs.',
  title: `${publicConfig.brand.name} — ${publicConfig.brand.tagline}`,
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <html lang="en-CA">
      <body>
        {children}
        <BetaAnalytics enabled={publicConfig.beta.analyticsEnabled} />
      </body>
    </html>
  );
}

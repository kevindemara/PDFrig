'use client';

import { createBrowserClient } from '@supabase/ssr';

import { parsePublicConfig } from '@pdfmason/config/public';

export const createSupabaseBrowserClient = () => {
  const config = parsePublicConfig(process.env);
  if (config.auth.supabaseUrl === null || config.auth.publishableKey === null) {
    throw new Error('Supabase authentication is not configured.');
  }
  return createBrowserClient(config.auth.supabaseUrl, config.auth.publishableKey);
};

import { createClient } from '@supabase/supabase-js';

import { parseServerConfig } from '@pdfmason/config/server';

export const createSupabaseAdminClient = () => {
  const serverConfig = parseServerConfig(process.env);
  if (serverConfig.trustedSupabase === null) {
    throw new Error('Trusted Supabase access is not configured.');
  }
  return createClient(serverConfig.trustedSupabase.url, serverConfig.trustedSupabase.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

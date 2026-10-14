import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { parsePublicConfig } from '@pdfmason/config/public';

export const createSupabaseServerClient = async () => {
  const config = parsePublicConfig(process.env);
  if (config.auth.supabaseUrl === null || config.auth.publishableKey === null) {
    throw new Error('Supabase authentication is not configured.');
  }
  const cookieStore = await cookies();
  return createServerClient(config.auth.supabaseUrl, config.auth.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const cookie of cookiesToSet) {
            cookieStore.set(cookie.name, cookie.value, cookie.options);
          }
        } catch {
          // Server Components cannot write cookies. The request proxy refreshes them.
        }
      },
    },
  });
};

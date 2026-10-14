import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

import { parsePublicConfig } from '@pdfmason/config/public';

export const refreshSupabaseSession = async (request: NextRequest): Promise<NextResponse> => {
  const config = parsePublicConfig(process.env);
  let response = NextResponse.next({ request });
  if (config.auth.supabaseUrl === null || config.auth.publishableKey === null) return response;

  const supabase = createServerClient(config.auth.supabaseUrl, config.auth.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const cookie of cookiesToSet) request.cookies.set(cookie.name, cookie.value);
        response = NextResponse.next({ request });
        for (const cookie of cookiesToSet) {
          response.cookies.set(cookie.name, cookie.value, cookie.options);
        }
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
};

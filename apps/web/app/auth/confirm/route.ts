import { type NextRequest, NextResponse } from 'next/server';

import { parsePublicConfig } from '@pdfmason/config/public';

import { createSupabaseServerClient } from '../../../lib/supabase/server';

export async function GET(request: NextRequest) {
  const publicConfig = parsePublicConfig(process.env);
  const code = request.nextUrl.searchParams.get('code');
  const redirect = new URL('/account', publicConfig.applicationUrl);
  if (code !== null && publicConfig.auth.enabled) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error === null) return NextResponse.redirect(redirect);
  }
  redirect.searchParams.set('auth', 'failed');
  return NextResponse.redirect(redirect);
}

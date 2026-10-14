import { NextRequest } from 'next/server';

import { refreshSupabaseSession } from './lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const developmentEval = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';
  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' 'nonce-${nonce}' 'strict-dynamic'${developmentEval}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' ws: wss:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);
  requestHeaders.set('x-nonce', nonce);
  const securityRequest = new NextRequest(request, { headers: requestHeaders });
  const response = await refreshSupabaseSession(securityRequest);
  response.headers.set('Content-Security-Policy', contentSecurityPolicy);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

export const config = {
  matcher: [
    {
      missing: [
        { key: 'next-router-prefetch', type: 'header' },
        { key: 'purpose', type: 'header', value: 'prefetch' },
      ],
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
    },
  ],
};

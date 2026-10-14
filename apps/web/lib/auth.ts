import type { CloudPrincipal } from '@pdfmason/contracts';
import { parseServerConfig } from '@pdfmason/config/server';
import { z } from 'zod';

import { createSupabaseServerClient } from './supabase/server';

export interface AuthenticatedPrincipal extends CloudPrincipal {
  readonly authenticatedAt: number;
  readonly email: string;
}

export const DEVELOPMENT_PRINCIPAL: AuthenticatedPrincipal = Object.freeze({
  authenticatedAt: 0,
  email: 'local-demo@example.invalid',
  emailVerified: true,
  userId: '01111111-1111-4111-8111-111111111111',
  workspaceId: '02222222-2222-4222-8222-222222222222',
});

export const resolvePrincipal = async (): Promise<AuthenticatedPrincipal | null> => {
  const serverConfig = parseServerConfig(process.env);
  if (serverConfig.providerMode === 'fake') return DEVELOPMENT_PRINCIPAL;

  const supabase = await createSupabaseServerClient();
  const { data: claimsResult, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError !== null || claimsResult === null) return null;
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError !== null || userResult.user.email === undefined) return null;
  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('id,status')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (workspaceError !== null || workspace === null) return null;
  const workspaceId = z.object({ id: z.uuid() }).parse(workspace).id;

  return Object.freeze({
    authenticatedAt: typeof claimsResult.claims.iat === 'number' ? claimsResult.claims.iat : 0,
    email: userResult.user.email,
    emailVerified: typeof userResult.user.email_confirmed_at === 'string',
    userId: claimsResult.claims.sub,
    workspaceId,
  });
};

import type { AuthenticatedPrincipal } from './auth';
import { resolvePrincipal } from './auth';
import { ApiFault } from './api';

export const requirePrincipal = async (): Promise<AuthenticatedPrincipal> => {
  const principal = await resolvePrincipal();
  if (principal === null) throw new ApiFault('AUTH_REQUIRED', 'Sign in to continue.', 401);
  return principal;
};

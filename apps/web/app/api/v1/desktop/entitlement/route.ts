import { apiErrorResponse, safeJson } from '../../../../../lib/api';
import { createSignedDesktopEntitlement } from '../../../../../lib/desktop-entitlement';

export async function GET(request: Request) {
  try {
    return safeJson(await createSignedDesktopEntitlement(request));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

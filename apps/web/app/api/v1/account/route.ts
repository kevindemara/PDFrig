import { apiErrorResponse, safeJson } from '../../../../lib/api';
import { getCloudService } from '../../../../lib/cloud/service';
import { requirePrincipal } from '../../../../lib/route-auth';

export async function GET() {
  try {
    const principal = await requirePrincipal();
    return safeJson(await getCloudService().getAccount(principal));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

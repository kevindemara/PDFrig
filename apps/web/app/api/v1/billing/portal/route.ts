import { apiErrorResponse, requireMutationOrigin, safeJson } from '../../../../../lib/api';
import { getCloudService } from '../../../../../lib/cloud/service';
import { requirePrincipal } from '../../../../../lib/route-auth';

export async function POST(request: Request) {
  try {
    requireMutationOrigin(request);
    const principal = await requirePrincipal();
    return safeJson(await getCloudService().createPortal(principal), 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

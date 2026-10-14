import { uuidSchema } from '@pdfmason/contracts';

import { apiErrorResponse, safeJson } from '../../../../../../lib/api';
import { getCloudService } from '../../../../../../lib/cloud/service';
import { requirePrincipal } from '../../../../../../lib/route-auth';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const principal = await requirePrincipal();
    return safeJson(await getCloudService().createDownloadGrant(principal, uuidSchema.parse(id)));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

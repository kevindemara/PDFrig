import { uuidSchema } from '@pdfmason/contracts';

import { ApiFault, apiErrorResponse, safeJson } from '../../../../../lib/api';
import { getCloudService } from '../../../../../lib/cloud/service';
import { requirePrincipal } from '../../../../../lib/route-auth';

export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = uuidSchema.parse(rawId);
    const principal = await requirePrincipal();
    const job = await getCloudService().getJob(principal, id);
    if (job === null) throw new ApiFault('NOT_FOUND', 'The requested job was not found.', 404);
    return safeJson(job);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

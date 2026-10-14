import { uuidSchema } from '@pdfmason/contracts';

import {
  ApiFault,
  apiErrorResponse,
  requireMutationOrigin,
  safeJson,
} from '../../../../../../lib/api';
import { getCloudService } from '../../../../../../lib/cloud/service';
import { requirePrincipal } from '../../../../../../lib/route-auth';

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
) {
  try {
    requireMutationOrigin(request);
    const { id: rawId } = await context.params;
    const principal = await requirePrincipal();
    const job = await getCloudService().cancelJob(principal, uuidSchema.parse(rawId));
    if (job === null) throw new ApiFault('NOT_FOUND', 'The requested job was not found.', 404);
    return safeJson(job);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

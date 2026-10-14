import { uploadAuthorizationRequestSchema } from '@pdfmason/contracts';

import {
  apiErrorResponse,
  parseJsonBody,
  requireMutationOrigin,
  safeJson,
} from '../../../../lib/api';
import { getCloudService } from '../../../../lib/cloud/service';
import { requirePrincipal } from '../../../../lib/route-auth';

export async function POST(request: Request) {
  try {
    requireMutationOrigin(request);
    const input = await parseJsonBody(request, uploadAuthorizationRequestSchema.strict());
    const principal = await requirePrincipal();
    return safeJson(await getCloudService().authorizeUpload(principal, input), 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

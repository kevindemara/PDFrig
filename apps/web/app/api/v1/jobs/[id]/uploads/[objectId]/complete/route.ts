import { uploadCompletionRequestSchema, uuidSchema } from '@pdfmason/contracts';

import {
  apiErrorResponse,
  parseJsonBody,
  requireMutationOrigin,
  safeJson,
} from '../../../../../../../../lib/api';
import { getCloudService } from '../../../../../../../../lib/cloud/service';
import { requirePrincipal } from '../../../../../../../../lib/route-auth';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; objectId: string }> },
) {
  try {
    requireMutationOrigin(request);
    const { id, objectId } = await context.params;
    const jobId = uuidSchema.parse(id);
    const uploadObjectId = uuidSchema.parse(objectId);
    const input = await parseJsonBody(request, uploadCompletionRequestSchema.strict());
    const principal = await requirePrincipal();
    return safeJson(
      await getCloudService().completeUpload(principal, jobId, uploadObjectId, input),
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

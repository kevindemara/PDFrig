import { betaSupportRequestSchema } from '@pdfmason/contracts';

import {
  ApiFault,
  apiErrorResponse,
  parseJsonBody,
  requireMutationOrigin,
  safeJson,
} from '../../../../../lib/api';
import { getBetaService } from '../../../../../lib/beta/service';

export async function POST(request: Request) {
  try {
    requireMutationOrigin(request);
    const input = await parseJsonBody(request, betaSupportRequestSchema);
    const service = getBetaService('intake');
    if (service === null)
      throw new ApiFault(
        'PROVIDER_UNAVAILABLE',
        'Support intake is not connected in this environment.',
        503,
        true,
      );
    return safeJson(await service.submitSupport(input), 202);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

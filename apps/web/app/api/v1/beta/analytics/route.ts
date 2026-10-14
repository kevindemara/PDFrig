import { betaAnalyticsEventSchema } from '@pdfmason/contracts';

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
    const input = await parseJsonBody(request, betaAnalyticsEventSchema);
    const service = getBetaService('analytics');
    if (service === null)
      throw new ApiFault(
        'PROVIDER_UNAVAILABLE',
        'Optional analytics are disabled in this environment.',
        503,
      );
    await service.recordAnalytics(input);
    return safeJson({ accepted: true }, 202);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

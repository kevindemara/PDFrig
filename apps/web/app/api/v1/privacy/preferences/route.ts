import { privacyPreferencesSchema } from '@pdfmason/contracts';

import {
  apiErrorResponse,
  parseJsonBody,
  requireMutationOrigin,
  safeJson,
} from '../../../../../lib/api';
import { getCloudService } from '../../../../../lib/cloud/service';
import { requirePrincipal } from '../../../../../lib/route-auth';

export async function POST(request: Request) {
  try {
    requireMutationOrigin(request);
    const input = await parseJsonBody(request, privacyPreferencesSchema.strict());
    const principal = await requirePrincipal();
    const retainJobHistory = await getCloudService().setHistoryPreference(
      principal,
      input.retainJobHistory,
    );
    return safeJson({ retainJobHistory });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

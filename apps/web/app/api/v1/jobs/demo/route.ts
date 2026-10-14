import { z } from 'zod';

import { idempotencyKeySchema } from '@pdfmason/contracts';

import {
  apiErrorResponse,
  parseJsonBody,
  requireMutationOrigin,
  safeJson,
} from '../../../../../lib/api';
import { getCloudService } from '../../../../../lib/cloud/service';
import { requirePrincipal } from '../../../../../lib/route-auth';

const demoRequestSchema = z.object({ idempotencyKey: idempotencyKeySchema }).strict();

export async function POST(request: Request) {
  try {
    requireMutationOrigin(request);
    const input = await parseJsonBody(request, demoRequestSchema);
    const principal = await requirePrincipal();
    return safeJson(await getCloudService().createDemoJob(principal, input.idempotencyKey), 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

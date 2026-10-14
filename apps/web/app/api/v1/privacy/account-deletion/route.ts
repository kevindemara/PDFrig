import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  apiErrorResponse,
  parseJsonBody,
  requireMutationOrigin,
  safeJson,
} from '../../../../../lib/api';
import { getCloudService } from '../../../../../lib/cloud/service';
import { requirePrincipal } from '../../../../../lib/route-auth';

const accountDeletionSchema = z.object({ confirmation: z.literal('DELETE') }).strict();

export async function POST(request: Request) {
  try {
    requireMutationOrigin(request);
    await parseJsonBody(request, accountDeletionSchema);
    const principal = await requirePrincipal();
    const accepted = await getCloudService().requestAccountDeletion(
      principal,
      `account-delete-${randomUUID()}`,
    );
    return safeJson({ accepted, next: 'object_reconciliation' }, 202);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

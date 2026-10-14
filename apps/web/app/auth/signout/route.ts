import { apiErrorResponse, requireMutationOrigin, safeJson } from '../../../lib/api';
import { createSupabaseServerClient } from '../../../lib/supabase/server';

export async function POST(request: Request) {
  try {
    requireMutationOrigin(request);
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    return safeJson({ signedOut: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

import { parseServerConfig } from '@pdfmason/config/server';
import { z } from 'zod';

import { ApiFault, apiErrorResponse, safeJson } from '../../../../../lib/api';
import {
  createStripeClient,
  verifyAndNormalizeStripeEvent,
  type StripeBillingConfig,
} from '../../../../../lib/providers/stripe';
import { createSupabaseAdminClient } from '../../../../../lib/supabase/admin';

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('stripe-signature');
    if (signature === null)
      throw new ApiFault('WEBHOOK_INVALID', 'Webhook signature is missing.', 400);
    const config = parseServerConfig(process.env);
    if (config.production === null) {
      throw new ApiFault('WEBHOOK_INVALID', 'Production billing is not configured.', 404);
    }
    const stripeConfig: StripeBillingConfig = { ...config.production.stripe };
    const event = await verifyAndNormalizeStripeEvent(
      createStripeClient(stripeConfig.restrictedKey),
      stripeConfig,
      await request.text(),
      signature,
    );
    if (event?.subscription === null || event === null)
      return safeJson({ accepted: true, state: 'ignored' });
    const subscription = event.subscription;
    const admin = createSupabaseAdminClient();
    const rpcResponse: unknown = await admin.rpc('accept_stripe_subscription_event', {
      ends_at_period_end: subscription.cancelAtPeriodEnd,
      internal_plan_key: subscription.planKey,
      normalized_status: subscription.status,
      period_end: subscription.currentPeriodEnd,
      period_start: subscription.currentPeriodStart,
      stripe_customer_id: subscription.providerCustomerId,
      stripe_event_created_at: event.createdAt,
      stripe_event_id: event.eventId,
      stripe_event_type: event.eventType,
      stripe_subscription_id: subscription.providerSubscriptionId,
      subscription_currency: subscription.currency,
      target_workspace_id: subscription.workspaceId,
    });
    const { data, error } = z
      .object({ data: z.unknown(), error: z.object({ message: z.string() }).nullable() })
      .parse(rpcResponse);
    if (error !== null)
      throw new ApiFault('PROVIDER_UNAVAILABLE', 'Webhook acceptance will retry.', 503, true);
    return safeJson({ accepted: true, state: String(data) });
  } catch (error) {
    return apiErrorResponse(
      error instanceof ApiFault
        ? error
        : new ApiFault('WEBHOOK_INVALID', 'Webhook verification failed.', 400),
    );
  }
}

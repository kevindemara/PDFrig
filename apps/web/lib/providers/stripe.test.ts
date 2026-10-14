import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import {
  createStripeClient,
  verifyAndNormalizeStripeEvent,
  type StripeBillingConfig,
} from './stripe';

describe('Stripe webhook boundary', () => {
  it('verifies the raw signature while normalizing checkout as non-entitling state', async () => {
    const secret = ['whsec', 'synthetic-fixture'].join('_');
    const payload = JSON.stringify({
      api_version: Stripe.API_VERSION,
      created: 1_777_000_000,
      data: {
        object: {
          client_reference_id: '81111111-1111-4111-8111-111111111111',
          customer: 'cus_synthetic',
          id: 'cs_synthetic',
          metadata: {},
          object: 'checkout.session',
          subscription: 'sub_synthetic',
        },
      },
      id: 'evt_synthetic_checkout',
      object: 'event',
      type: 'checkout.session.completed',
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const config: StripeBillingConfig = {
      priceByPlan: { pro_annual: 'price_annual_fixture', pro_monthly: 'price_monthly_fixture' },
      restrictedKey: ['rk', 'test', 'synthetic'].join('_'),
      webhookSecret: secret,
    };
    const event = await verifyAndNormalizeStripeEvent(
      createStripeClient(config.restrictedKey),
      config,
      payload,
      signature,
    );

    expect(event?.subscription?.status).toBe('none');
    expect(event?.subscription?.planKey).toBe('free');
    expect(event?.subscription?.workspaceId).toBe('81111111-1111-4111-8111-111111111111');
  });

  it('rejects a changed raw body with the original signature', async () => {
    const secret = ['whsec', 'synthetic-fixture'].join('_');
    const payload = JSON.stringify({
      created: 1,
      data: { object: {} },
      id: 'evt_1',
      object: 'event',
      type: 'unknown',
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const config: StripeBillingConfig = {
      priceByPlan: { pro_annual: 'price_annual_fixture', pro_monthly: 'price_monthly_fixture' },
      restrictedKey: ['rk', 'test', 'synthetic'].join('_'),
      webhookSecret: secret,
    };
    await expect(
      verifyAndNormalizeStripeEvent(
        createStripeClient(config.restrictedKey),
        config,
        `${payload} `,
        signature,
      ),
    ).rejects.toThrow();
  });
});

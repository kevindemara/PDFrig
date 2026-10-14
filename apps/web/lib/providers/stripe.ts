import { randomBytes } from 'node:crypto';

import Stripe from 'stripe';

import type {
  PlanKey,
  ProviderWebhookEvent,
  SubscriptionBillingGateway,
  SubscriptionCheckoutRequest,
  SubscriptionPortalRequest,
  SubscriptionRedirect,
  SubscriptionStatus,
} from '@pdfmason/contracts';
import { uuidSchema } from '@pdfmason/contracts';

export interface StripeBillingConfig {
  readonly priceByPlan: {
    readonly pro_annual: string;
    readonly pro_monthly: string;
  };
  readonly restrictedKey: string;
  readonly webhookSecret: string;
}

const isoFromUnix = (seconds: number): string => new Date(seconds * 1000).toISOString();

const randomIntegrationIdentifier = (): string =>
  `pdfmason_web_${[...randomBytes(8)].map((value) => String.fromCharCode(97 + (value % 26))).join('')}`;

export const createStripeClient = (restrictedKey: string): Stripe =>
  new Stripe(restrictedKey, { telemetry: false, typescript: true });

export class StripeSubscriptionBillingGateway implements SubscriptionBillingGateway {
  readonly #config: StripeBillingConfig;
  readonly #stripe: Stripe;

  public constructor(stripe: Stripe, config: StripeBillingConfig) {
    this.#stripe = stripe;
    this.#config = config;
  }

  public async createCheckout(request: SubscriptionCheckoutRequest): Promise<SubscriptionRedirect> {
    const session = await this.#stripe.checkout.sessions.create(
      {
        cancel_url: request.cancelUrl,
        client_reference_id: request.workspaceId,
        customer_email: request.userEmail,
        integration_identifier: randomIntegrationIdentifier(),
        line_items: [{ price: this.#config.priceByPlan[request.planKey], quantity: 1 }],
        metadata: {
          pdfmason_plan_key: request.planKey,
          pdfmason_workspace_id: request.workspaceId,
        },
        mode: 'subscription',
        subscription_data: {
          metadata: {
            pdfmason_plan_key: request.planKey,
            pdfmason_workspace_id: request.workspaceId,
          },
        },
        success_url: request.successUrl,
      },
      { idempotencyKey: request.idempotencyKey },
    );
    if (session.url === null) throw new Error('STRIPE_CHECKOUT_URL_MISSING');
    return Object.freeze({
      expiresAt: isoFromUnix(session.expires_at),
      providerReference: session.id,
      url: session.url,
    });
  }

  public async createPortal(request: SubscriptionPortalRequest): Promise<SubscriptionRedirect> {
    const session = await this.#stripe.billingPortal.sessions.create({
      customer: request.providerCustomerId,
      return_url: request.returnUrl,
    });
    return Object.freeze({
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      providerReference: session.id,
      url: session.url,
    });
  }
}

const normalizeStatus = (status: Stripe.Subscription.Status): SubscriptionStatus => {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    case 'paused':
      return 'paused';
    case 'unpaid':
      return 'unpaid';
    case 'canceled':
      return 'cancelled';
    case 'incomplete':
    case 'incomplete_expired':
      return 'none';
    default:
      return 'none';
  }
};

const objectId = (value: string | { readonly id: string }): string =>
  typeof value === 'string' ? value : value.id;

const planForSubscription = (
  subscription: Stripe.Subscription,
  config: StripeBillingConfig,
): PlanKey => {
  const priceId = subscription.items.data[0]?.price.id;
  if (priceId === config.priceByPlan.pro_monthly) return 'pro_monthly';
  if (priceId === config.priceByPlan.pro_annual) return 'pro_annual';
  throw new Error('STRIPE_PRICE_UNMAPPED');
};

const normalizeSubscription = (
  event: Stripe.Event,
  subscription: Stripe.Subscription,
  config: StripeBillingConfig,
): ProviderWebhookEvent => {
  const item = subscription.items.data[0];
  if (item === undefined) throw new Error('STRIPE_SUBSCRIPTION_ITEM_MISSING');
  const workspaceId = uuidSchema.parse(subscription.metadata.pdfmason_workspace_id);
  return Object.freeze({
    createdAt: isoFromUnix(event.created),
    eventId: event.id,
    eventType: event.type,
    provider: 'stripe',
    subscription: Object.freeze({
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currency: subscription.currency.toUpperCase(),
      currentPeriodEnd: isoFromUnix(item.current_period_end),
      currentPeriodStart: isoFromUnix(item.current_period_start),
      planKey: planForSubscription(subscription, config),
      providerCustomerId: objectId(subscription.customer),
      providerSubscriptionId: subscription.id,
      status: normalizeStatus(subscription.status),
      workspaceId,
    }),
  });
};

const hasObjectType = (value: unknown, objectType: string): boolean =>
  typeof value === 'object' && value !== null && 'object' in value && value.object === objectType;
const isSubscription = (value: unknown): value is Stripe.Subscription =>
  hasObjectType(value, 'subscription');
const isInvoice = (value: unknown): value is Stripe.Invoice => hasObjectType(value, 'invoice');
const isCheckoutSession = (value: unknown): value is Stripe.Checkout.Session =>
  hasObjectType(value, 'checkout.session');

export const verifyAndNormalizeStripeEvent = async (
  stripe: Stripe,
  config: StripeBillingConfig,
  rawBody: string,
  signature: string,
): Promise<ProviderWebhookEvent | null> => {
  const event = stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
  const eventObject = event.data.object;

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    if (!isSubscription(eventObject)) throw new Error('STRIPE_EVENT_OBJECT_INVALID');
    const authoritative = await stripe.subscriptions.retrieve(eventObject.id);
    return normalizeSubscription(event, authoritative, config);
  }

  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    if (!isInvoice(eventObject)) throw new Error('STRIPE_EVENT_OBJECT_INVALID');
    const subscriptionReference = eventObject.parent?.subscription_details?.subscription;
    if (subscriptionReference === undefined) {
      throw new Error('STRIPE_INVOICE_SUBSCRIPTION_MISSING');
    }
    const authoritative = await stripe.subscriptions.retrieve(objectId(subscriptionReference));
    return normalizeSubscription(event, authoritative, config);
  }

  if (event.type === 'checkout.session.completed') {
    if (!isCheckoutSession(eventObject)) throw new Error('STRIPE_EVENT_OBJECT_INVALID');
    const workspaceId = uuidSchema.parse(
      eventObject.client_reference_id ?? eventObject.metadata?.pdfmason_workspace_id,
    );
    if (eventObject.customer === null) throw new Error('STRIPE_CHECKOUT_CUSTOMER_MISSING');
    return Object.freeze({
      createdAt: isoFromUnix(event.created),
      eventId: event.id,
      eventType: event.type,
      provider: 'stripe',
      subscription: Object.freeze({
        cancelAtPeriodEnd: false,
        currency: 'CAD',
        currentPeriodEnd: null,
        currentPeriodStart: null,
        planKey: 'free',
        providerCustomerId: objectId(eventObject.customer),
        providerSubscriptionId:
          eventObject.subscription === null ? null : objectId(eventObject.subscription),
        status: 'none',
        workspaceId,
      }),
    });
  }

  return null;
};

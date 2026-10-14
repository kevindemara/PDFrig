export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];

export interface StoredObjectMetadata {
  readonly byteLength: number;
  readonly contentType: string;
  readonly createdAt: string;
  readonly objectId: string;
  readonly sha256: string;
}

export interface ObjectStorage {
  delete(objectId: string): Promise<void>;
  get(objectId: string): Promise<Uint8Array | null>;
  metadata(objectId: string): Promise<StoredObjectMetadata | null>;
  put(input: {
    readonly bytes: Uint8Array;
    readonly contentType: string;
    readonly sha256: string;
  }): Promise<StoredObjectMetadata>;
}

export type JobState = 'queued' | 'claimed' | 'cancelled' | 'completed' | 'failed';

export interface JobRequest {
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly options: JsonValue;
  readonly workspaceId: string;
}

export interface JobRecord extends JobRequest {
  readonly createdAt: string;
  readonly id: string;
  readonly state: JobState;
}

export interface JobCoordinator {
  cancel(jobId: string): Promise<JobRecord | null>;
  claim(): Promise<JobRecord | null>;
  enqueue(request: JobRequest): Promise<JobRecord>;
  get(jobId: string): Promise<JobRecord | null>;
}

export interface BillingCheckoutRequest {
  readonly planKey: string;
  readonly returnUrl: string;
  readonly workspaceId: string;
}

export interface BillingCheckoutReference {
  readonly checkoutId: string;
  readonly provider: 'fake';
}

export interface BillingGateway {
  createCheckout(request: BillingCheckoutRequest): Promise<BillingCheckoutReference>;
}

export interface Entitlement {
  readonly enabled: boolean;
  readonly featureKey: string;
  readonly limit: number | null;
  readonly revision: number;
}

export interface EntitlementService {
  resolve(workspaceId: string, featureKey: string): Promise<Entitlement>;
}

export interface PrivateObjectHead {
  readonly byteLength: number;
  readonly contentType: string;
  readonly sha256: string | null;
}

export interface PrivateObjectGrant {
  readonly expiresAt: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: 'GET' | 'PUT';
  readonly url: string;
}

export interface PrivateObjectStorage {
  createDownloadGrant(input: {
    readonly downloadName: string;
    readonly expiresInSeconds: number;
    readonly objectKey: string;
  }): Promise<PrivateObjectGrant>;
  createUploadGrant(input: {
    readonly byteLength: number;
    readonly contentType: string;
    readonly expiresInSeconds: number;
    readonly objectKey: string;
    readonly sha256: string;
  }): Promise<PrivateObjectGrant>;
  delete(objectKey: string): Promise<void>;
  exists(objectKey: string): Promise<boolean>;
  head(objectKey: string): Promise<PrivateObjectHead | null>;
}

export interface SubscriptionCheckoutRequest {
  readonly cancelUrl: string;
  readonly idempotencyKey: string;
  readonly planKey: 'pro_annual' | 'pro_monthly';
  readonly successUrl: string;
  readonly userEmail: string;
  readonly workspaceId: string;
}

export interface SubscriptionPortalRequest {
  readonly providerCustomerId: string;
  readonly returnUrl: string;
}

export interface SubscriptionRedirect {
  readonly expiresAt: string;
  readonly providerReference: string;
  readonly url: string;
}

export interface SubscriptionBillingGateway {
  createCheckout(request: SubscriptionCheckoutRequest): Promise<SubscriptionRedirect>;
  createPortal(request: SubscriptionPortalRequest): Promise<SubscriptionRedirect>;
}

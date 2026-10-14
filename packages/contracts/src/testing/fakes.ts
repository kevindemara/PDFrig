import type {
  BillingCheckoutReference,
  BillingCheckoutRequest,
  BillingGateway,
  Entitlement,
  EntitlementService,
  JobCoordinator,
  JobRecord,
  JobRequest,
  ObjectStorage,
  PrivateObjectGrant,
  PrivateObjectHead,
  PrivateObjectStorage,
  StoredObjectMetadata,
  SubscriptionBillingGateway,
  SubscriptionCheckoutRequest,
  SubscriptionPortalRequest,
  SubscriptionRedirect,
} from '../providers.js';

type IdFactory = () => string;
type Clock = () => Date;

const defaultIdFactory: IdFactory = () => globalThis.crypto.randomUUID();
const defaultClock: Clock = () => new Date();

export class InMemoryObjectStorage implements ObjectStorage {
  readonly #clock: Clock;
  readonly #idFactory: IdFactory;
  readonly #objects = new Map<string, { bytes: Uint8Array; metadata: StoredObjectMetadata }>();

  public constructor(options: { readonly clock?: Clock; readonly idFactory?: IdFactory } = {}) {
    this.#clock = options.clock ?? defaultClock;
    this.#idFactory = options.idFactory ?? defaultIdFactory;
  }

  public delete(objectId: string): Promise<void> {
    this.#objects.delete(objectId);
    return Promise.resolve();
  }

  public get(objectId: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.#objects.get(objectId)?.bytes.slice() ?? null);
  }

  public metadata(objectId: string): Promise<StoredObjectMetadata | null> {
    return Promise.resolve(this.#objects.get(objectId)?.metadata ?? null);
  }

  public put(input: {
    readonly bytes: Uint8Array;
    readonly contentType: string;
    readonly sha256: string;
  }): Promise<StoredObjectMetadata> {
    const objectId = this.#idFactory();
    const metadata: StoredObjectMetadata = Object.freeze({
      byteLength: input.bytes.byteLength,
      contentType: input.contentType,
      createdAt: this.#clock().toISOString(),
      objectId,
      sha256: input.sha256,
    });
    this.#objects.set(objectId, { bytes: input.bytes.slice(), metadata });
    return Promise.resolve(metadata);
  }
}

export class InMemoryJobCoordinator implements JobCoordinator {
  readonly #clock: Clock;
  readonly #idFactory: IdFactory;
  readonly #jobs = new Map<string, JobRecord>();
  readonly #jobsByIdempotencyKey = new Map<string, string>();

  public constructor(options: { readonly clock?: Clock; readonly idFactory?: IdFactory } = {}) {
    this.#clock = options.clock ?? defaultClock;
    this.#idFactory = options.idFactory ?? defaultIdFactory;
  }

  public cancel(jobId: string): Promise<JobRecord | null> {
    const current = this.#jobs.get(jobId);
    if (current === undefined || current.state === 'completed' || current.state === 'failed') {
      return Promise.resolve(current ?? null);
    }
    return Promise.resolve(this.#replace(current, 'cancelled'));
  }

  public claim(): Promise<JobRecord | null> {
    const queued = [...this.#jobs.values()].find((job) => job.state === 'queued');
    return Promise.resolve(queued === undefined ? null : this.#replace(queued, 'claimed'));
  }

  public enqueue(request: JobRequest): Promise<JobRecord> {
    const idempotencyScope = `${request.workspaceId}:${request.idempotencyKey}`;
    const existingId = this.#jobsByIdempotencyKey.get(idempotencyScope);
    if (existingId !== undefined) {
      const existing = this.#jobs.get(existingId);
      if (existing !== undefined) return Promise.resolve(existing);
    }

    const record: JobRecord = Object.freeze({
      ...request,
      createdAt: this.#clock().toISOString(),
      id: this.#idFactory(),
      state: 'queued',
    });
    this.#jobs.set(record.id, record);
    this.#jobsByIdempotencyKey.set(idempotencyScope, record.id);
    return Promise.resolve(record);
  }

  public get(jobId: string): Promise<JobRecord | null> {
    return Promise.resolve(this.#jobs.get(jobId) ?? null);
  }

  #replace(current: JobRecord, state: JobRecord['state']): JobRecord {
    const replacement = Object.freeze({ ...current, state });
    this.#jobs.set(current.id, replacement);
    return replacement;
  }
}

export class FakeBillingGateway implements BillingGateway {
  readonly #idFactory: IdFactory;
  readonly requests: BillingCheckoutRequest[] = [];

  public constructor(idFactory: IdFactory = defaultIdFactory) {
    this.#idFactory = idFactory;
  }

  public createCheckout(request: BillingCheckoutRequest): Promise<BillingCheckoutReference> {
    this.requests.push(Object.freeze({ ...request }));
    return Promise.resolve(Object.freeze({ checkoutId: this.#idFactory(), provider: 'fake' }));
  }
}

export class FakeEntitlementService implements EntitlementService {
  readonly #entitlements = new Map<string, Entitlement>();

  public resolve(workspaceId: string, featureKey: string): Promise<Entitlement> {
    return Promise.resolve(
      this.#entitlements.get(this.#key(workspaceId, featureKey)) ??
        Object.freeze({ enabled: false, featureKey, limit: null, revision: 0 }),
    );
  }

  public set(workspaceId: string, entitlement: Entitlement): void {
    this.#entitlements.set(this.#key(workspaceId, entitlement.featureKey), {
      ...entitlement,
    });
  }

  #key(workspaceId: string, featureKey: string): string {
    return `${workspaceId}:${featureKey}`;
  }
}

export class InMemoryPrivateObjectStorage implements PrivateObjectStorage {
  readonly #clock: Clock;
  readonly #objects = new Map<
    string,
    { readonly bytes?: Uint8Array; readonly head: PrivateObjectHead }
  >();

  public constructor(clock: Clock = defaultClock) {
    this.#clock = clock;
  }

  public createDownloadGrant(input: {
    readonly downloadName: string;
    readonly expiresInSeconds: number;
    readonly objectKey: string;
  }): Promise<PrivateObjectGrant> {
    return Promise.resolve(this.#grant('GET', input.objectKey, input.expiresInSeconds, {}));
  }

  public createUploadGrant(input: {
    readonly byteLength: number;
    readonly contentType: string;
    readonly expiresInSeconds: number;
    readonly objectKey: string;
    readonly sha256: string;
  }): Promise<PrivateObjectGrant> {
    this.#objects.set(input.objectKey, {
      head: {
        byteLength: input.byteLength,
        contentType: input.contentType,
        sha256: input.sha256,
      },
    });
    return Promise.resolve(
      this.#grant('PUT', input.objectKey, input.expiresInSeconds, {
        'content-type': input.contentType,
        'x-pdfmason-sha256': input.sha256,
      }),
    );
  }

  public delete(objectKey: string): Promise<void> {
    this.#objects.delete(objectKey);
    return Promise.resolve();
  }

  public exists(objectKey: string): Promise<boolean> {
    return Promise.resolve(this.#objects.has(objectKey));
  }

  public head(objectKey: string): Promise<PrivateObjectHead | null> {
    return Promise.resolve(this.#objects.get(objectKey)?.head ?? null);
  }

  public seed(objectKey: string, head: PrivateObjectHead): void {
    this.#objects.set(objectKey, { head });
  }

  #grant(
    method: PrivateObjectGrant['method'],
    objectKey: string,
    expiresInSeconds: number,
    headers: Readonly<Record<string, string>>,
  ): PrivateObjectGrant {
    const expiresAt = new Date(this.#clock().getTime() + expiresInSeconds * 1000).toISOString();
    const token = Buffer.from(`${method}:${objectKey}:${expiresAt}`).toString('base64url');
    return Object.freeze({
      expiresAt,
      headers: Object.freeze({ ...headers }),
      method,
      url: `https://storage.example.invalid/grant/${token}`,
    });
  }
}

export class FakeSubscriptionBillingGateway implements SubscriptionBillingGateway {
  readonly #clock: Clock;
  readonly #idFactory: IdFactory;
  readonly checkoutRequests: SubscriptionCheckoutRequest[] = [];
  readonly portalRequests: SubscriptionPortalRequest[] = [];

  public constructor(options: { readonly clock?: Clock; readonly idFactory?: IdFactory } = {}) {
    this.#clock = options.clock ?? defaultClock;
    this.#idFactory = options.idFactory ?? defaultIdFactory;
  }

  public createCheckout(request: SubscriptionCheckoutRequest): Promise<SubscriptionRedirect> {
    this.checkoutRequests.push(Object.freeze({ ...request }));
    return Promise.resolve(this.#redirect('checkout'));
  }

  public createPortal(request: SubscriptionPortalRequest): Promise<SubscriptionRedirect> {
    this.portalRequests.push(Object.freeze({ ...request }));
    return Promise.resolve(this.#redirect('portal'));
  }

  #redirect(kind: 'checkout' | 'portal'): SubscriptionRedirect {
    const reference = this.#idFactory();
    return Object.freeze({
      expiresAt: new Date(this.#clock().getTime() + 30 * 60 * 1000).toISOString(),
      providerReference: reference,
      url: `https://billing.example.invalid/${kind}/${reference}`,
    });
  }
}

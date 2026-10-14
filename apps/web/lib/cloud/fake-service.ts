import type {
  BillingRedirect,
  CreateBillingCheckoutRequest,
  ObjectGrant,
  SafeCloudJob,
  UploadAuthorizationRequest,
  UploadAuthorizationResponse,
} from '@pdfmason/contracts';
import { calculateDeleteAfter } from '@pdfmason/contracts';

import type { AuthenticatedPrincipal } from '../auth';
import type { AccountSnapshot, CloudService } from './types';

interface InternalJob {
  readonly idempotencyKey: string;
  readonly job: SafeCloudJob;
  readonly workspaceId: string;
}

type Clock = () => Date;
type IdFactory = () => string;

export class FakeCloudService implements CloudService {
  readonly #clock: Clock;
  readonly #history = new Map<string, boolean>();
  readonly #idFactory: IdFactory;
  readonly #jobs = new Map<string, InternalJob>();

  public constructor(options: { readonly clock?: Clock; readonly idFactory?: IdFactory } = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  public authorizeUpload(
    principal: AuthenticatedPrincipal,
    request: UploadAuthorizationRequest,
  ): Promise<UploadAuthorizationResponse> {
    const jobId = this.#idFactory();
    const objectId = `object_${this.#idFactory().replaceAll('-', '')}`;
    const now = this.#clock();
    const job = this.#createJob(principal, jobId, request.idempotencyKey, now);
    this.#jobs.set(jobId, {
      idempotencyKey: request.idempotencyKey,
      job,
      workspaceId: principal.workspaceId,
    });
    return Promise.resolve(
      Object.freeze({
        grant: Object.freeze({
          expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
          headers: Object.freeze({
            'content-type': request.contentType,
            'x-pdfmason-sha256': request.sha256,
          }),
          method: 'PUT',
          objectId,
          url: `https://storage.example.invalid/grant/${objectId}`,
        }),
        jobId,
        retention: Object.freeze({
          deleteAfter: calculateDeleteAfter(now, 1),
          explanation: 'Synthetic local demo objects expire after one hour.',
        }),
      }),
    );
  }

  public cancelJob(principal: AuthenticatedPrincipal, jobId: string): Promise<SafeCloudJob | null> {
    const internal = this.#jobs.get(jobId);
    if (internal?.workspaceId !== principal.workspaceId) return Promise.resolve(null);
    if (!['awaiting_upload', 'queued', 'processing', 'retry_wait'].includes(internal.job.state)) {
      return Promise.resolve(internal.job);
    }
    return Promise.resolve(
      this.#replace(internal, {
        progressStage: 'cancelled',
        progressValue: null,
        state: 'cancelled',
      }),
    );
  }

  public completeUpload(principal: AuthenticatedPrincipal, jobId: string): Promise<SafeCloudJob> {
    const internal = this.#jobs.get(jobId);
    if (internal?.workspaceId !== principal.workspaceId) {
      return Promise.reject(new Error('UPLOAD_NOT_FOUND'));
    }
    return Promise.resolve(
      this.#replace(internal, { progressStage: 'queued', progressValue: 0, state: 'queued' }),
    );
  }

  public createCheckout(
    principal: AuthenticatedPrincipal,
    request: CreateBillingCheckoutRequest,
  ): Promise<BillingRedirect> {
    const reference = this.#idFactory();
    return Promise.resolve(
      Object.freeze({
        expiresAt: new Date(this.#clock().getTime() + 30 * 60 * 1000).toISOString(),
        url: `/account?billing=checkout-demo&plan=${request.planKey}&workspace=${principal.workspaceId}&reference=${reference}`,
      }),
    );
  }

  public createDemoJob(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string,
  ): Promise<SafeCloudJob> {
    const existing = [...this.#jobs.values()].find(
      (candidate) =>
        candidate.workspaceId === principal.workspaceId &&
        candidate.idempotencyKey === idempotencyKey,
    );
    if (existing !== undefined) return Promise.resolve(this.#progress(existing));
    const id = this.#idFactory();
    const job = this.#createJob(principal, id, idempotencyKey, this.#clock());
    const internal = { idempotencyKey, job, workspaceId: principal.workspaceId };
    this.#jobs.set(id, internal);
    return Promise.resolve(job);
  }

  public createPortal(principal: AuthenticatedPrincipal): Promise<BillingRedirect> {
    return Promise.resolve(
      Object.freeze({
        expiresAt: new Date(this.#clock().getTime() + 30 * 60 * 1000).toISOString(),
        url: `/account?billing=portal-demo&workspace=${principal.workspaceId}`,
      }),
    );
  }

  public createDownloadGrant(
    principal: AuthenticatedPrincipal,
    jobId: string,
  ): Promise<ObjectGrant> {
    const internal = this.#jobs.get(jobId);
    if (
      internal?.workspaceId !== principal.workspaceId ||
      this.#progress(internal).state !== 'completed'
    ) {
      return Promise.reject(new Error('OUTPUT_NOT_FOUND'));
    }
    const objectId = `output_${jobId.replaceAll('-', '')}`;
    return Promise.resolve(
      Object.freeze({
        expiresAt: new Date(this.#clock().getTime() + 5 * 60 * 1000).toISOString(),
        headers: Object.freeze({}),
        method: 'GET' as const,
        objectId,
        url: `https://storage.example.invalid/grant/${objectId}`,
      }),
    );
  }

  public deleteJob(principal: AuthenticatedPrincipal, jobId: string): Promise<SafeCloudJob | null> {
    const internal = this.#jobs.get(jobId);
    if (internal?.workspaceId !== principal.workspaceId) return Promise.resolve(null);
    return Promise.resolve(
      this.#replace(internal, {
        completedAt: internal.job.completedAt ?? this.#clock().toISOString(),
        progressStage: 'deleted',
        progressValue: 100,
        state: 'deleted',
      }),
    );
  }

  public getAccount(principal: AuthenticatedPrincipal): Promise<AccountSnapshot> {
    const jobs = [...this.#jobs.values()]
      .filter((candidate) => candidate.workspaceId === principal.workspaceId)
      .map((candidate) => this.#progress(candidate))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return Promise.resolve(
      Object.freeze({
        email: principal.email,
        emailVerified: principal.emailVerified,
        entitlements: Object.freeze([
          Object.freeze({
            enabled: true,
            featureKey: 'cloud.demo.integrity',
            limitUnit: 'jobs' as const,
            limitValue: 3,
            usedValue: jobs.filter((job) => job.state !== 'deleted').length,
          }),
        ]),
        historyEnabled: this.#history.get(principal.workspaceId) ?? false,
        jobs: Object.freeze(jobs),
        localDemo: true,
        planKey: 'free',
        processingRegion: 'Local development',
        retention: Object.freeze({ historyDays: 30, outputHours: 1, safetyNetHours: 24 }),
        subscriptionStatus: 'none',
        workspaceId: principal.workspaceId,
      }),
    );
  }

  public getJob(principal: AuthenticatedPrincipal, jobId: string): Promise<SafeCloudJob | null> {
    const internal = this.#jobs.get(jobId);
    if (internal?.workspaceId !== principal.workspaceId) return Promise.resolve(null);
    return Promise.resolve(this.#progress(internal));
  }

  public requestAccountDeletion(principal: AuthenticatedPrincipal): Promise<boolean> {
    for (const [id, internal] of this.#jobs) {
      if (internal.workspaceId === principal.workspaceId && internal.job.state !== 'deleted') {
        this.#jobs.set(id, {
          ...internal,
          job: Object.freeze({
            ...internal.job,
            progressStage: 'deleting',
            progressValue: null,
            state: 'deleting',
          }),
        });
      }
    }
    return Promise.resolve(true);
  }

  public setHistoryPreference(
    principal: AuthenticatedPrincipal,
    retainJobHistory: boolean,
  ): Promise<boolean> {
    this.#history.set(principal.workspaceId, retainJobHistory);
    return Promise.resolve(retainJobHistory);
  }

  #createJob(
    _principal: AuthenticatedPrincipal,
    id: string,
    _idempotencyKey: string,
    now: Date,
  ): SafeCloudJob {
    return Object.freeze({
      completedAt: null,
      createdAt: now.toISOString(),
      deleteAfter: calculateDeleteAfter(now, 1),
      errorCode: null,
      id,
      operation: 'demo.integrity',
      operationVersion: '1.0.0',
      progressStage: 'queued',
      progressValue: 0,
      state: 'queued',
      warningCodes: [],
    });
  }

  #progress(internal: InternalJob): SafeCloudJob {
    if (['cancelled', 'completed', 'deleted', 'failed'].includes(internal.job.state))
      return internal.job;
    const elapsed = this.#clock().getTime() - new Date(internal.job.createdAt).getTime();
    if (elapsed >= 1_500) {
      return this.#replace(internal, {
        completedAt: this.#clock().toISOString(),
        progressStage: 'complete',
        progressValue: 100,
        state: 'completed',
      });
    }
    if (elapsed >= 500) {
      return this.#replace(internal, {
        progressStage: 'verifying',
        progressValue: 65,
        state: 'processing',
      });
    }
    return internal.job;
  }

  #replace(internal: InternalJob, changes: Partial<SafeCloudJob>): SafeCloudJob {
    const replacement = Object.freeze({ ...internal.job, ...changes });
    this.#jobs.set(internal.job.id, { ...internal, job: replacement });
    return replacement;
  }
}

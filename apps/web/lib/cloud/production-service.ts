import { z } from 'zod';

import {
  billingRedirectSchema,
  calculateDeleteAfter,
  isoTimestampSchema,
  objectGrantSchema,
  safeCloudJobSchema,
  uuidSchema,
  type BillingRedirect,
  type CreateBillingCheckoutRequest,
  type ObjectGrant,
  type SafeCloudJob,
  type UploadAuthorizationRequest,
  type UploadAuthorizationResponse,
  type UploadCompletionRequest,
} from '@pdfmason/contracts';
import { parsePublicConfig } from '@pdfmason/config/public';
import { parseServerConfig } from '@pdfmason/config/server';

import type { AuthenticatedPrincipal } from '../auth';
import { ApiFault } from '../api';
import { createOpaqueStorageKey, R2PrivateObjectStorage } from '../providers/r2';
import {
  createStripeClient,
  StripeSubscriptionBillingGateway,
  type StripeBillingConfig,
} from '../providers/stripe';
import { createSupabaseAdminClient } from '../supabase/admin';
import type { AccountSnapshot, CloudService } from './types';
import { throwCloudDatabaseFault } from './database-fault';

const databaseJobSchema = z.object({
  completed_at: isoTimestampSchema.nullable(),
  created_at: isoTimestampSchema,
  delete_after: isoTimestampSchema,
  error_code: z.string().nullable(),
  id: uuidSchema,
  operation: z.string(),
  operation_version: z.string(),
  progress_stage: z.string(),
  progress_value: z.number().int().nullable(),
  state: z.string(),
  warning_codes: z.array(z.string()),
});

const rpcResponseSchema = z.object({
  data: z.unknown(),
  error: z.object({ message: z.string() }).nullable(),
});

const mapJob = (input: z.infer<typeof databaseJobSchema>): SafeCloudJob =>
  safeCloudJobSchema.parse({
    completedAt: input.completed_at,
    createdAt: input.created_at,
    deleteAfter: input.delete_after,
    errorCode: input.error_code,
    id: input.id,
    operation: input.operation,
    operationVersion: input.operation_version,
    progressStage: input.progress_stage,
    progressValue: input.progress_value,
    state: input.state,
    warningCodes: input.warning_codes,
  });

const jobSelection =
  'id,operation,operation_version,state,progress_stage,progress_value,error_code,warning_codes,created_at,completed_at,delete_after';

export class ProductionCloudService implements CloudService {
  readonly #billing: StripeSubscriptionBillingGateway;
  readonly #config: ReturnType<typeof parseServerConfig>;
  readonly #storage: R2PrivateObjectStorage;

  public constructor() {
    this.#config = parseServerConfig(process.env);
    if (this.#config.production === null)
      throw new Error('Production providers are not configured.');
    const stripeConfig: StripeBillingConfig = {
      ...this.#config.production.stripe,
    };
    this.#billing = new StripeSubscriptionBillingGateway(
      createStripeClient(stripeConfig.restrictedKey),
      stripeConfig,
    );
    this.#storage = new R2PrivateObjectStorage(this.#config.production.r2);
  }

  public async authorizeUpload(
    principal: AuthenticatedPrincipal,
    request: UploadAuthorizationRequest,
  ): Promise<UploadAuthorizationResponse> {
    if (!principal.emailVerified) {
      throw new ApiFault(
        'EMAIL_VERIFICATION_REQUIRED',
        'Verify your email before secure cloud processing.',
        403,
      );
    }
    const admin = createSupabaseAdminClient();
    const now = new Date();
    const deleteAfter = calculateDeleteAfter(now, this.#config.retention.outputHours);
    const jobResponse: unknown = await admin.rpc('create_cloud_job_with_reservation', {
      actor_user_id: principal.userId,
      deletion_deadline: deleteAfter,
      entitlement_feature_key: 'cloud.demo.integrity',
      job_operation: request.operation,
      job_operation_version: request.operationVersion,
      job_options: { expectedSha256: request.sha256 },
      request_idempotency_key: request.idempotencyKey,
      target_workspace_id: principal.workspaceId,
      usage_period_key: now.toISOString().slice(0, 7),
      usage_quantity: 1,
      usage_unit: 'jobs',
    });
    const { data: jobData, error: jobError } = rpcResponseSchema.parse(jobResponse);
    if (jobError !== null) this.#throwDatabaseFault(jobError.message);
    const jobId = uuidSchema.parse(jobData);
    // A deterministic input ID makes an idempotent authorization replay converge on one object.
    const objectId = jobId;
    const storageKey = createOpaqueStorageKey({
      environment: this.#config.applicationEnvironment,
      jobId,
      objectId,
      role: 'input',
      workspaceId: principal.workspaceId,
    });
    const { error: objectError } = await admin.from('job_objects').upsert(
      {
        byte_size: request.byteLength,
        delete_after: deleteAfter,
        id: objectId,
        job_id: jobId,
        mime_type: request.contentType,
        role: 'input',
        sha256: request.sha256,
        state: 'pending',
        storage_key: storageKey,
        workspace_id: principal.workspaceId,
      },
      { ignoreDuplicates: true, onConflict: 'id' },
    );
    if (objectError !== null) {
      await admin.rpc('request_cloud_job_deletion', {
        actor_user_id: principal.userId,
        target_job_id: jobId,
        target_workspace_id: principal.workspaceId,
      });
      await admin.rpc('settle_cloud_job_usage', {
        consume_usage: false,
        target_job_id: jobId,
      });
      throw new ApiFault('PROVIDER_UNAVAILABLE', 'Upload authorization stopped safely.', 503, true);
    }
    const { data: canonicalData, error: canonicalError } = await admin
      .from('job_objects')
      .select('id,storage_key,byte_size,mime_type,sha256,state,delete_after')
      .eq('workspace_id', principal.workspaceId)
      .eq('job_id', jobId)
      .eq('id', objectId)
      .eq('role', 'input')
      .maybeSingle();
    if (canonicalError !== null) this.#throwDatabaseFault(canonicalError.message);
    const canonical = z
      .object({
        byte_size: z.number().int().positive(),
        delete_after: isoTimestampSchema,
        id: uuidSchema,
        mime_type: z.string(),
        sha256: z.string(),
        state: z.string(),
        storage_key: z.string().min(24),
      })
      .nullable()
      .parse(canonicalData);
    if (canonical === null) {
      throw new ApiFault('PROVIDER_UNAVAILABLE', 'Upload authorization stopped safely.', 503, true);
    }
    if (
      canonical.byte_size !== request.byteLength ||
      canonical.mime_type !== request.contentType ||
      canonical.sha256 !== request.sha256 ||
      canonical.state !== 'pending'
    ) {
      throw new ApiFault(
        'STATE_CONFLICT',
        'This idempotency key is already bound to a different or completed upload.',
        409,
      );
    }
    const grant = await this.#storage.createUploadGrant({
      byteLength: request.byteLength,
      contentType: request.contentType,
      expiresInSeconds: this.#config.storageGrantSeconds,
      objectKey: canonical.storage_key,
      sha256: request.sha256,
    });
    return Object.freeze({
      grant: Object.freeze({ ...grant, objectId }),
      jobId,
      retention: Object.freeze({
        deleteAfter: canonical.delete_after,
        explanation: `Temporary objects are deleted after ${this.#config.retention.outputHours} hour.`,
      }),
    });
  }

  public async cancelJob(
    principal: AuthenticatedPrincipal,
    jobId: string,
  ): Promise<SafeCloudJob | null> {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc('request_cloud_job_cancellation', {
      actor_user_id: principal.userId,
      target_job_id: jobId,
      target_workspace_id: principal.workspaceId,
    });
    if (error !== null) this.#throwDatabaseFault(error.message);
    return this.getJob(principal, jobId);
  }

  public async completeUpload(
    principal: AuthenticatedPrincipal,
    jobId: string,
    objectId: string,
    request: UploadCompletionRequest,
  ): Promise<SafeCloudJob> {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('job_objects')
      .select('id,storage_key,byte_size,mime_type,sha256,state')
      .eq('workspace_id', principal.workspaceId)
      .eq('job_id', jobId)
      .eq('id', objectId)
      .eq('role', 'input')
      .maybeSingle();
    if (error !== null) this.#throwDatabaseFault(error.message);
    const object = z
      .object({
        byte_size: z.number().int().positive(),
        id: uuidSchema,
        mime_type: z.literal('application/pdf'),
        sha256: z.string(),
        state: z.enum(['pending', 'uploaded', 'verified']),
        storage_key: z.string(),
      })
      .nullable()
      .parse(data);
    if (object === null) throw new ApiFault('NOT_FOUND', 'The upload was not found.', 404);

    const head = await this.#storage.head(object.storage_key);
    const verified =
      head !== null &&
      head.byteLength === object.byte_size &&
      head.byteLength === request.byteLength &&
      head.contentType === object.mime_type &&
      head.sha256 === object.sha256 &&
      head.sha256 === request.sha256;
    if (!verified) {
      await this.#storage.delete(object.storage_key).catch(() => undefined);
      await admin.rpc('request_cloud_job_deletion', {
        actor_user_id: principal.userId,
        target_job_id: jobId,
        target_workspace_id: principal.workspaceId,
      });
      await admin.rpc('settle_cloud_job_usage', { consume_usage: false, target_job_id: jobId });
      throw new ApiFault(
        'STATE_CONFLICT',
        'The uploaded object did not match its authorization and was discarded.',
        409,
      );
    }

    if (object.state !== 'verified') {
      const { error: updateError } = await admin
        .from('job_objects')
        .update({ state: 'verified', uploaded_at: new Date().toISOString() })
        .eq('workspace_id', principal.workspaceId)
        .eq('job_id', jobId)
        .eq('id', object.id)
        .in('state', ['pending', 'uploaded']);
      if (updateError !== null) this.#throwDatabaseFault(updateError.message);
      const { error: transitionError } = await admin.rpc('transition_cloud_job', {
        expected_state: 'awaiting_upload',
        next_progress: 0,
        next_stage: 'queued',
        next_state: 'queued',
        safe_error_code: null,
        target_job_id: jobId,
      });
      if (transitionError !== null) this.#throwDatabaseFault(transitionError.message);
    }
    const job = await this.getJob(principal, jobId);
    if (job === null) throw new ApiFault('NOT_FOUND', 'The job was not found.', 404);
    return job;
  }

  public async createCheckout(
    principal: AuthenticatedPrincipal,
    request: CreateBillingCheckoutRequest,
  ): Promise<BillingRedirect> {
    const publicConfig = parsePublicConfig(process.env);
    const redirect = await this.#billing.createCheckout({
      cancelUrl: new URL('/account?billing=cancelled', publicConfig.applicationUrl).toString(),
      idempotencyKey: request.idempotencyKey,
      planKey: request.planKey,
      successUrl: new URL('/account?billing=pending', publicConfig.applicationUrl).toString(),
      userEmail: principal.email,
      workspaceId: principal.workspaceId,
    });
    return billingRedirectSchema.parse({ expiresAt: redirect.expiresAt, url: redirect.url });
  }

  public async createDemoJob(
    principal: AuthenticatedPrincipal,
    idempotencyKey: string,
  ): Promise<SafeCloudJob> {
    const admin = createSupabaseAdminClient();
    const now = new Date();
    const jobResponse: unknown = await admin.rpc('create_cloud_job_with_reservation', {
      actor_user_id: principal.userId,
      deletion_deadline: calculateDeleteAfter(now, this.#config.retention.outputHours),
      entitlement_feature_key: 'cloud.demo.integrity',
      job_operation: 'demo.integrity',
      job_operation_version: '1.0.0',
      job_options: {},
      request_idempotency_key: idempotencyKey,
      target_workspace_id: principal.workspaceId,
      usage_period_key: now.toISOString().slice(0, 7),
      usage_quantity: 1,
      usage_unit: 'jobs',
    });
    const { data, error } = rpcResponseSchema.parse(jobResponse);
    if (error !== null) this.#throwDatabaseFault(error.message);
    const job = await this.getJob(principal, uuidSchema.parse(data));
    if (job === null)
      throw new ApiFault(
        'PROVIDER_UNAVAILABLE',
        'The job was not readable after creation.',
        503,
        true,
      );
    return job;
  }

  public async createPortal(principal: AuthenticatedPrincipal): Promise<BillingRedirect> {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('subscriptions')
      .select('provider_customer_id')
      .eq('workspace_id', principal.workspaceId)
      .maybeSingle();
    if (error !== null) this.#throwDatabaseFault(error.message);
    const row = z.object({ provider_customer_id: z.string().nullable() }).nullable().parse(data);
    if (row?.provider_customer_id === null || row === null) {
      throw new ApiFault(
        'ENTITLEMENT_REQUIRED',
        'Start a subscription before opening billing management.',
        409,
      );
    }
    const publicConfig = parsePublicConfig(process.env);
    const redirect = await this.#billing.createPortal({
      providerCustomerId: row.provider_customer_id,
      returnUrl: new URL('/account', publicConfig.applicationUrl).toString(),
    });
    return billingRedirectSchema.parse({ expiresAt: redirect.expiresAt, url: redirect.url });
  }

  public async createDownloadGrant(
    principal: AuthenticatedPrincipal,
    jobId: string,
  ): Promise<ObjectGrant> {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('job_objects')
      .select('id,storage_key')
      .eq('workspace_id', principal.workspaceId)
      .eq('job_id', jobId)
      .eq('role', 'output')
      .eq('state', 'verified')
      .limit(1)
      .maybeSingle();
    if (error !== null) this.#throwDatabaseFault(error.message);
    const object = z
      .object({ id: uuidSchema, storage_key: z.string().min(24) })
      .nullable()
      .parse(data);
    if (object === null)
      throw new ApiFault('NOT_FOUND', 'No downloadable output is available.', 404);
    const grant = await this.#storage.createDownloadGrant({
      downloadName: `pdfmason-${jobId.slice(0, 8)}.pdf`,
      expiresInSeconds: this.#config.storageGrantSeconds,
      objectKey: object.storage_key,
    });
    return objectGrantSchema.parse({ ...grant, objectId: object.id });
  }

  public async deleteJob(
    principal: AuthenticatedPrincipal,
    jobId: string,
  ): Promise<SafeCloudJob | null> {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc('request_cloud_job_deletion', {
      actor_user_id: principal.userId,
      target_job_id: jobId,
      target_workspace_id: principal.workspaceId,
    });
    if (error !== null) this.#throwDatabaseFault(error.message);
    return this.getJob(principal, jobId);
  }

  public async getAccount(principal: AuthenticatedPrincipal): Promise<AccountSnapshot> {
    const admin = createSupabaseAdminClient();
    const [profileResult, subscriptionResult, entitlementResult, usageResult, jobsResult] =
      await Promise.all([
        admin
          .from('profiles')
          .select('retain_job_history')
          .eq('user_id', principal.userId)
          .single(),
        admin
          .from('subscriptions')
          .select('status,plan_key')
          .eq('workspace_id', principal.workspaceId)
          .single(),
        admin
          .from('entitlement_snapshots')
          .select('feature_key,enabled,limit_value,limit_unit')
          .eq('workspace_id', principal.workspaceId),
        admin
          .from('usage_ledger')
          .select('feature_key,quantity,status')
          .eq('workspace_id', principal.workspaceId)
          .in('status', ['reserved', 'consumed']),
        admin
          .from('jobs')
          .select(jobSelection)
          .eq('workspace_id', principal.workspaceId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
    for (const result of [
      profileResult,
      subscriptionResult,
      entitlementResult,
      usageResult,
      jobsResult,
    ]) {
      if (result.error !== null) this.#throwDatabaseFault(result.error.message);
    }
    const profile = z.object({ retain_job_history: z.boolean() }).parse(profileResult.data);
    const subscription = z
      .object({
        plan_key: z.enum(['free', 'pro_annual', 'pro_monthly']),
        status: z.enum(['active', 'cancelled', 'none', 'past_due', 'paused', 'trialing', 'unpaid']),
      })
      .parse(subscriptionResult.data);
    const usage = z
      .array(z.object({ feature_key: z.string(), quantity: z.number().int(), status: z.string() }))
      .parse(usageResult.data);
    const usedByFeature = new Map<string, number>();
    for (const entry of usage) {
      usedByFeature.set(
        entry.feature_key,
        (usedByFeature.get(entry.feature_key) ?? 0) + entry.quantity,
      );
    }
    const entitlements = z
      .array(
        z.object({
          enabled: z.boolean(),
          feature_key: z.string(),
          limit_unit: z.enum(['bytes', 'jobs', 'pages']).nullable(),
          limit_value: z.number().int().nullable(),
        }),
      )
      .parse(entitlementResult.data as unknown)
      .map((entry) =>
        Object.freeze({
          enabled: entry.enabled,
          featureKey: entry.feature_key,
          limitUnit: entry.limit_unit,
          limitValue: entry.limit_value,
          usedValue: usedByFeature.get(entry.feature_key) ?? 0,
        }),
      );
    const jobs = z
      .array(databaseJobSchema)
      .parse(jobsResult.data as unknown)
      .map(mapJob);
    return Object.freeze({
      email: principal.email,
      emailVerified: principal.emailVerified,
      entitlements: Object.freeze(entitlements),
      historyEnabled: profile.retain_job_history,
      jobs: Object.freeze(jobs),
      localDemo: false,
      planKey: subscription.plan_key,
      processingRegion: this.#config.processingRegion,
      retention: this.#config.retention,
      subscriptionStatus: subscription.status,
      workspaceId: principal.workspaceId,
    });
  }

  public async getJob(
    principal: AuthenticatedPrincipal,
    jobId: string,
  ): Promise<SafeCloudJob | null> {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('jobs')
      .select(jobSelection)
      .eq('workspace_id', principal.workspaceId)
      .eq('id', jobId)
      .maybeSingle();
    if (error !== null) this.#throwDatabaseFault(error.message);
    return data === null ? null : mapJob(databaseJobSchema.parse(data));
  }

  public async requestAccountDeletion(
    principal: AuthenticatedPrincipal,
    requestId: string,
  ): Promise<boolean> {
    const currentEpochSeconds = Math.floor(Date.now() / 1000);
    if (principal.authenticatedAt <= 0 || currentEpochSeconds - principal.authenticatedAt > 300) {
      throw new ApiFault(
        'AUTH_REQUIRED',
        'Sign in again before requesting permanent account deletion.',
        401,
      );
    }
    const admin = createSupabaseAdminClient();
    const deletionResponse: unknown = await admin.rpc('request_account_deletion', {
      actor_user_id: principal.userId,
      request_id: requestId,
      target_workspace_id: principal.workspaceId,
    });
    const { data, error } = rpcResponseSchema.parse(deletionResponse);
    if (error !== null) this.#throwDatabaseFault(error.message);
    return z.boolean().parse(data);
  }

  public async setHistoryPreference(
    principal: AuthenticatedPrincipal,
    retainJobHistory: boolean,
  ): Promise<boolean> {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('profiles')
      .update({ retain_job_history: retainJobHistory })
      .eq('user_id', principal.userId);
    if (error !== null) this.#throwDatabaseFault(error.message);
    return retainJobHistory;
  }

  #throwDatabaseFault(message: string): never {
    return throwCloudDatabaseFault(message);
  }
}

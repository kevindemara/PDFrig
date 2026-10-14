import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { ServerConfig } from '@pdfmason/config/server';
import { type createSafeLogger } from '@pdfmason/observability';

import { runDemoIntegrityOperation } from './demo-integrity.js';
import { WorkerPrivateObjectStore } from './r2.js';

const claimedJobSchema = z.object({
  attempt_count: z.number().int().positive(),
  id: z.uuid(),
  max_attempts: z.number().int().positive(),
  operation: z.string(),
  state: z.literal('processing'),
});
const deletionObjectSchema = z.object({ id: z.uuid(), storage_key: z.string().min(24) });
const deletingJobSchema = z.object({ id: z.uuid() });
const deletingWorkspaceSchema = z.object({ id: z.uuid(), owner_user_id: z.uuid() });
const rpcResponseSchema = z.object({
  data: z.unknown(),
  error: z.object({ message: z.string() }).nullable(),
});
const attemptResolutionSchema = z
  .enum(['completed', 'cancelled', 'failed', 'retry_wait'])
  .nullable();
type Logger = ReturnType<typeof createSafeLogger>;

/** Isolates the SDK's schema-generic client until generated database types are checked in. */
const createAdminClient = (url: string, secretKey: string): SupabaseClient =>
  createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as SupabaseClient;

export class ProductionWorkerCoordinator {
  readonly #admin: SupabaseClient;
  readonly #config: ServerConfig;
  readonly #logger: Logger;
  readonly #storage: WorkerPrivateObjectStore;
  readonly #workerId: string;

  public constructor(config: ServerConfig, logger: Logger) {
    if (config.production === null)
      throw new Error('Production worker configuration is incomplete.');
    this.#config = config;
    this.#logger = logger;
    this.#workerId = `worker-${randomUUID()}`;
    this.#admin = createAdminClient(
      config.production.supabaseUrl,
      config.production.supabaseSecretKey,
    );
    this.#storage = new WorkerPrivateObjectStore(config.production.r2);
  }

  public async tick(): Promise<void> {
    await this.#recoverAttempts();
    await this.#reconcileDeletion();
    await this.#finalizeAccountDeletion();
    await this.#processNextJob();
  }

  async #processNextJob(): Promise<void> {
    const response: unknown = await this.#admin.rpc('claim_cloud_job', {
      lease_seconds: this.#config.worker.leaseSeconds,
      worker_id: this.#workerId,
    });
    const { data, error } = rpcResponseSchema.parse(response);
    if (error !== null) {
      this.#logger.log('error', 'worker.claim_failed', { errorCode: 'DATABASE_UNAVAILABLE' });
      return;
    }
    const jobs = z.array(claimedJobSchema).parse(data);
    const job = jobs[0];
    if (job === undefined) return;
    const startedAt = Date.now();
    try {
      if (job.operation !== 'demo.integrity') throw new Error('OPERATION_NOT_IMPLEMENTED');
      const signal = AbortSignal.timeout(Math.min(30_000, this.#config.worker.leaseSeconds * 500));
      await runDemoIntegrityOperation({ signal });
    } catch {
      await this.#resolveAttempt(job, false, startedAt);
      return;
    }
    // Resolution errors are not operation failures. Retry/recovery owns an expired lease.
    await this.#resolveAttempt(job, true, startedAt);
  }

  async #recoverAttempts(): Promise<void> {
    const now = new Date().toISOString();
    const { data } = await this.#admin
      .from('jobs')
      .select('id')
      .in('state', ['processing', 'cancelling'])
      .or(`lease_expires_at.is.null,lease_expires_at.lte.${now}`)
      .limit(20);
    for (const row of z.array(deletingJobSchema).catch([]).parse(data)) {
      const { data: result, error } = rpcResponseSchema.parse(
        await this.#admin.rpc('recover_cloud_job', { target_job_id: row.id }),
      );
      if (error !== null || !attemptResolutionSchema.safeParse(result).success) {
        this.#logger.log('error', 'worker.recovery_failed', { errorCode: 'DATABASE_UNAVAILABLE' });
      }
    }
  }

  async #reconcileDeletion(): Promise<void> {
    const { data: objects } = await this.#admin
      .from('job_objects')
      .select('id,storage_key')
      .neq('state', 'deleted')
      .lte('delete_after', new Date().toISOString())
      .limit(20);
    for (const object of z.array(deletionObjectSchema).catch([]).parse(objects)) {
      let succeeded = false;
      try {
        succeeded = await this.#storage.deleteAndConfirm(object.storage_key);
      } catch {
        succeeded = false;
      }
      await this.#admin.rpc('record_job_object_deletion', {
        deletion_succeeded: succeeded,
        safe_error_code: succeeded ? null : 'STORAGE_UNAVAILABLE',
        target_object_id: object.id,
      });
      if (!succeeded) {
        this.#logger.log('warn', 'worker.object_delete_failed', {
          errorCode: 'STORAGE_UNAVAILABLE',
          retryable: true,
        });
      }
    }

    const { data: jobs } = await this.#admin
      .from('jobs')
      .select('id')
      .eq('state', 'deleting')
      .limit(20);
    for (const job of z.array(deletingJobSchema).catch([]).parse(jobs)) {
      const { count } = await this.#admin
        .from('job_objects')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', job.id)
        .neq('state', 'deleted');
      if (count === 0) {
        await this.#transition(job.id, 'deleting', 'deleted', 'deleted', 100, null);
      }
    }
  }

  async #finalizeAccountDeletion(): Promise<void> {
    const { data: workspaces } = await this.#admin
      .from('workspaces')
      .select('id,owner_user_id')
      .eq('status', 'deleting')
      .limit(10);
    for (const workspace of z.array(deletingWorkspaceSchema).catch([]).parse(workspaces)) {
      const [objects, jobs] = await Promise.all([
        this.#admin
          .from('job_objects')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .neq('state', 'deleted'),
        this.#admin
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .neq('state', 'deleted'),
      ]);
      if (objects.count !== 0 || jobs.count !== 0) continue;
      const { error } = await this.#admin.auth.admin.deleteUser(workspace.owner_user_id);
      this.#logger.log(error === null ? 'info' : 'error', 'worker.account_delete_finished', {
        errorCode: error === null ? null : 'IDENTITY_DELETE_FAILED',
        retryable: error !== null,
      });
    }
  }

  async #resolveAttempt(
    job: z.infer<typeof claimedJobSchema>,
    succeeded: boolean,
    startedAt: number,
  ): Promise<void> {
    let resolution: z.infer<typeof attemptResolutionSchema>;
    try {
      const { data, error } = rpcResponseSchema.parse(
        await this.#admin.rpc('finish_cloud_job_attempt', {
          expected_attempt: job.attempt_count,
          succeeded,
          target_job_id: job.id,
          worker_id: this.#workerId,
        }),
      );
      if (error !== null) throw new Error('DATABASE_UNAVAILABLE');
      resolution = attemptResolutionSchema.parse(data);
    } catch {
      this.#logger.log('error', 'worker.result_commit_failed', {
        errorCode: 'DATABASE_UNAVAILABLE',
        jobId: job.id,
        retryable: true,
      });
      return;
    }
    if (resolution === null) {
      this.#logger.log('warn', 'worker.attempt_rejected', { jobId: job.id });
      return;
    }
    const failed = resolution === 'failed' || resolution === 'retry_wait';
    this.#logger.log(
      failed ? 'warn' : 'info',
      failed ? 'worker.job_attempt_failed' : 'worker.job_finished',
      {
        attemptCount: job.attempt_count,
        durationMs: Date.now() - startedAt,
        jobId: job.id,
        operation: job.operation,
        progressStage: resolution === 'completed' ? 'complete' : resolution,
        ...(failed
          ? { errorCode: 'OPERATION_FAILED', retryable: resolution === 'retry_wait' }
          : {}),
      },
    );
  }

  async #transition(
    jobId: string,
    expectedState: string,
    nextState: string,
    stage: string,
    progress: number | null,
    errorCode: string | null,
  ): Promise<void> {
    await this.#admin.rpc('transition_cloud_job', {
      expected_state: expectedState,
      next_progress: progress,
      next_stage: stage,
      next_state: nextState,
      safe_error_code: errorCode,
      target_job_id: jobId,
    });
  }
}

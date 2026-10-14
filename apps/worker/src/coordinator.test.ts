import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseServerConfig, type ServerConfig } from '@pdfmason/config/server';
import { createSafeLogger } from '@pdfmason/observability';

import { ProductionWorkerCoordinator } from './coordinator.js';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn<
    (
      name: string,
      args: Readonly<Record<string, unknown>>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  >(),
  from: vi.fn(),
  run: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mocks }));
vi.mock('./demo-integrity.js', () => ({ runDemoIntegrityOperation: mocks.run }));
vi.mock('./r2.js', () => ({
  WorkerPrivateObjectStore: class {
    public readonly deleteAndConfirm = vi.fn();
  },
}));

// Synthetic SDK boundary only: these tests never connect to storage or a database.
const config: ServerConfig = {
  ...parseServerConfig({}),
  production: {
    r2: {
      accessKeyId: 'synthetic',
      accountId: 'synthetic',
      bucket: 'synthetic',
      secretAccessKey: 'synthetic',
    },
    stripe: {
      priceByPlan: { pro_annual: 'synthetic', pro_monthly: 'synthetic' },
      restrictedKey: 'synthetic',
      webhookSecret: 'synthetic',
    },
    supabaseSecretKey: 'synthetic',
    supabaseUrl: 'http://127.0.0.1:1',
  },
};
const job = {
  id: '41111111-1111-4111-8111-111111111111',
  operation: 'demo.integrity',
  attempt_count: 2,
  max_attempts: 3,
  state: 'processing',
};
const emptyQuery = () => {
  const query = Object.assign(Promise.resolve({ data: [], count: null }), {
    select: () => query,
    eq: () => query,
    in: () => query,
    or: () => query,
    limit: () => query,
    neq: () => query,
    lte: () => query,
  });
  return query;
};

describe('cloud worker fenced attempt resolution — CONV-002/003/004, OCR-001', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.from.mockImplementation(emptyQuery);
    mocks.run.mockResolvedValue({});
  });
  const tick = async (resolution: unknown, failure = false) => {
    mocks.rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'claim_cloud_job'
          ? { data: [job], error: null }
          : { data: resolution, error: null },
      ),
    );
    if (failure) mocks.run.mockRejectedValue(new Error('DOCUMENT_CONTENT_CANARY'));
    const entries: string[] = [];
    await new ProductionWorkerCoordinator(
      config,
      createSafeLogger((entry) => entries.push(entry)),
    ).tick();
    const claim = mocks.rpc.mock.calls.find(([name]) => name === 'claim_cloud_job');
    expect(mocks.rpc).toHaveBeenCalledWith('finish_cloud_job_attempt', {
      expected_attempt: 2,
      succeeded: !failure,
      target_job_id: job.id,
      worker_id: claim?.[1]?.worker_id,
    });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_cloud_job',
      'finish_cloud_job_attempt',
    ]);
    expect(entries.join()).not.toContain('DOCUMENT_CONTENT_CANARY');
    return entries.join();
  };
  it('reports completion only after an accepted atomic result', async () => {
    expect(await tick('completed')).toContain('worker.job_finished');
  });
  it('reports cancellation rather than completion when cancellation won', async () => {
    expect(await tick('cancelled')).toContain('"progressStage":"cancelled"');
  });
  it('does not settle quota or report success for a stale worker', async () => {
    const log = await tick(null);
    expect(log).toContain('worker.attempt_rejected');
    expect(log).not.toContain('worker.job_finished');
  });
  it('uses the database retry decision and omits raw operation errors', async () => {
    expect(await tick('retry_wait', true)).toContain('"retryable":true');
  });
  it('uses the database final-attempt decision', async () => {
    expect(await tick('failed', true)).toContain('"retryable":false');
  });
  it.each(['unexpected', { state: 'completed' }])(
    'fails closed on malformed acknowledgement %j',
    async (value) => {
      const log = await tick(value);
      expect(log).toContain('worker.result_commit_failed');
      expect(log).not.toContain('worker.job_finished');
    },
  );
  it.each([false, true])(
    'does not convert a database failure into an operation retry (throw=%s)',
    async (throws) => {
      mocks.rpc.mockImplementation((name: string) => {
        if (name === 'claim_cloud_job') return Promise.resolve({ data: [job], error: null });
        if (throws) return Promise.reject(new Error('PROVIDER_SECRET_CANARY'));
        return Promise.resolve({ data: null, error: { message: 'PROVIDER_SECRET_CANARY' } });
      });
      const entries: string[] = [];
      await new ProductionWorkerCoordinator(
        config,
        createSafeLogger((entry) => entries.push(entry)),
      ).tick();
      expect(mocks.rpc).toHaveBeenCalledTimes(2);
      expect(entries.join()).toContain('worker.result_commit_failed');
      expect(entries.join()).not.toMatch(
        /PROVIDER_SECRET_CANARY|worker.job_finished|worker.job_attempt_failed/u,
      );
    },
  );
});

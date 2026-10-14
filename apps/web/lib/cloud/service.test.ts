import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../auth';
import type { CloudService } from './types';

const config = vi.hoisted((): { providerMode: 'fake' | 'production' } => ({
  providerMode: 'fake',
}));
vi.mock('@pdfmason/config/server', () => ({ parseServerConfig: () => config }));
vi.mock('./production-service', () => ({
  ProductionCloudService: class {
    public readonly marker = 'synthetic-production';
  },
}));
const registry = globalThis as typeof globalThis & { __pdfmasonFakeCloudService?: CloudService };
const owner: AuthenticatedPrincipal = {
  authenticatedAt: 0,
  email: 'synthetic@example.invalid',
  emailVerified: true,
  userId: '71111111-1111-4111-8111-111111111111',
  workspaceId: '81111111-1111-4111-8111-111111111111',
};

describe('SEC-006 local demo service lifetime', () => {
  beforeEach(() => {
    delete registry.__pdfmasonFakeCloudService;
    config.providerMode = 'fake';
    vi.resetModules();
  });
  afterEach(() => {
    delete registry.__pdfmasonFakeCloudService;
  });
  it('retains synthetic jobs and preferences across server module re-evaluation', async () => {
    const first = (await import('./service')).getCloudService();
    const job = await first.createDemoJob(owner, 'reload-regression-request');
    await first.setHistoryPreference(owner, true);
    vi.resetModules();
    const reloaded = (await import('./service')).getCloudService();
    expect(reloaded).toBe(first);
    expect((await reloaded.getAccount(owner)).jobs.map((entry) => entry.id)).toContain(job.id);
    expect((await reloaded.getAccount(owner)).historyEnabled).toBe(true);
    expect(
      await reloaded.getJob({ ...owner, workspaceId: crypto.randomUUID() }, job.id),
    ).toBeNull();
  });
  it('never initializes fake state in production mode', async () => {
    config.providerMode = 'production';
    const { getCloudService } = await import('./service');
    expect(getCloudService()).not.toBe(getCloudService());
    expect(registry.__pdfmasonFakeCloudService).toBeUndefined();
  });
  it('does not reuse fake state when configuration switches to production', async () => {
    const { getCloudService } = await import('./service');
    const fake = getCloudService();
    config.providerMode = 'production';
    expect(getCloudService()).not.toBe(fake);
    config.providerMode = 'fake';
    expect(getCloudService()).toBe(fake);
  });
});

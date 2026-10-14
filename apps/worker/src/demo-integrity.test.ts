import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runDemoIntegrityOperation } from './demo-integrity.js';

describe('harmless worker demonstration', () => {
  it('returns a deterministic content-free result and always cleans its attempt directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pdfmason-worker-test-'));
    try {
      const result = await runDemoIntegrityOperation({ temporaryRoot: root });
      expect(result).toEqual({
        digest: '7a494ae165275af1455030dd6a76dfc5b8c07ee694bc282c9d51162886ad6187',
        operation: 'demo.integrity',
        version: '1.0.0',
      });
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('honours cancellation before work and still removes local working data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pdfmason-worker-test-'));
    const controller = new AbortController();
    controller.abort(new Error('test cancellation'));
    try {
      await expect(
        runDemoIntegrityOperation({ signal: controller.signal, temporaryRoot: root }),
      ).rejects.toThrow('test cancellation');
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

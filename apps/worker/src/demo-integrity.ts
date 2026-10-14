import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export interface DemoIntegrityResult {
  readonly digest: string;
  readonly operation: 'demo.integrity';
  readonly version: '1.0.0';
}

export interface DemoIntegrityOptions {
  readonly signal?: AbortSignal;
  readonly temporaryRoot?: string;
}

const assertAttemptDirectory = (attemptDirectory: string, temporaryRoot: string): void => {
  const resolvedRoot = resolve(temporaryRoot);
  const resolvedAttempt = resolve(attemptDirectory);
  if (
    dirname(resolvedAttempt) !== resolvedRoot ||
    !basename(resolvedAttempt).startsWith('pdfmason-attempt-')
  ) {
    throw new Error('UNSAFE_ATTEMPT_DIRECTORY');
  }
};

/** Harmless queue/sandbox proof. It never accepts or opens a user document. */
export const runDemoIntegrityOperation = async (
  options: DemoIntegrityOptions = {},
): Promise<DemoIntegrityResult> => {
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  const attemptDirectory = await mkdtemp(join(temporaryRoot, 'pdfmason-attempt-'));
  assertAttemptDirectory(attemptDirectory, temporaryRoot);
  await chmod(attemptDirectory, 0o700);
  try {
    options.signal?.throwIfAborted();
    const digest = createHash('sha256')
      .update('PDFMason harmless cloud integrity check v1')
      .digest('hex');
    await new Promise<void>((resolveDelay, rejectDelay) => {
      const timer = setTimeout(resolveDelay, 25);
      options.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          const reason: unknown = options.signal?.reason;
          rejectDelay(reason instanceof Error ? reason : new Error('OPERATION_CANCELLED'));
        },
        { once: true },
      );
    });
    options.signal?.throwIfAborted();
    return Object.freeze({ digest, operation: 'demo.integrity', version: '1.0.0' });
  } finally {
    assertAttemptDirectory(attemptDirectory, temporaryRoot);
    await rm(attemptDirectory, { force: true, recursive: true });
  }
};

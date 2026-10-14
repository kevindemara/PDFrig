import { randomUUID } from 'node:crypto';

import type { z } from 'zod';

import type { ApiErrorCode, ApiErrorEnvelope } from '@pdfmason/contracts';
import { parseServerConfig } from '@pdfmason/config/server';
import { createSafeLogger } from '@pdfmason/observability';

const logger = createSafeLogger((entry) => console.info(entry));

export class ApiFault extends Error {
  public constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

const responseHeaders = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  Pragma: 'no-cache',
});

export const safeJson = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { headers: responseHeaders, status });

export const requireMutationOrigin = (request: Request): void => {
  const origin = request.headers.get('origin');
  const config = parseServerConfig(process.env);
  let normalizedOrigin: string | null = null;
  try {
    normalizedOrigin = origin === null ? null : new URL(origin).origin;
  } catch {
    normalizedOrigin = null;
  }
  if (normalizedOrigin === null || !config.allowedOrigins.includes(normalizedOrigin)) {
    throw new ApiFault('ORIGIN_REJECTED', 'This request origin is not allowed.', 403);
  }
};

export const parseJsonBody = async <Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.output<Schema>> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiFault('INPUT_INVALID', 'The request body must be valid JSON.', 400);
  }
  const result = schema.safeParse(body);
  if (!result.success)
    throw new ApiFault('INPUT_INVALID', 'The request did not match the expected format.', 400);
  return result.data;
};

export const apiErrorResponse = (error: unknown, requestId = randomUUID()): Response => {
  const fault =
    error instanceof ApiFault
      ? error
      : new ApiFault(
          'PROVIDER_UNAVAILABLE',
          'The operation stopped safely. Try again later.',
          503,
          true,
        );
  logger.log(fault.status >= 500 ? 'error' : 'warn', 'api.request_failed', {
    errorCode: fault.code,
    requestId,
    retryable: fault.retryable,
  });
  const envelope: ApiErrorEnvelope = {
    error: {
      code: fault.code,
      details: {},
      message: fault.message,
      requestId: requestId.replaceAll('-', ''),
      retryable: fault.retryable,
    },
  };
  return safeJson(envelope, fault.status);
};

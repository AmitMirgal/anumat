import { AppError, type ErrorCode } from '@anumat/core';
import { TRPCError, type TRPC_ERROR_CODE_KEY } from '@trpc/server';

const TRPC_CODES = {
  validation_failed: 'BAD_REQUEST',
  unauthorized: 'UNAUTHORIZED',
  not_found: 'NOT_FOUND',
  policy_not_published: 'NOT_FOUND',
  conflict: 'CONFLICT',
  version_not_proposed: 'CONFLICT',
  stale_proposal: 'CONFLICT',
  not_a_pdf: 'UNPROCESSABLE_CONTENT',
  conversion_failed: 'UNPROCESSABLE_CONTENT',
  not_a_policy: 'UNPROCESSABLE_CONTENT',
  extraction_invalid: 'UNPROCESSABLE_CONTENT',
  rate_limited: 'TOO_MANY_REQUESTS',
  internal: 'INTERNAL_SERVER_ERROR',
  fetch_failed: 'BAD_GATEWAY',
  extraction_failed: 'BAD_GATEWAY',
  llm_not_configured: 'SERVICE_UNAVAILABLE',
  ocr_not_configured: 'SERVICE_UNAVAILABLE',
} as const satisfies Record<ErrorCode, TRPC_ERROR_CODE_KEY>;

export function toTrpcError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  const app = error instanceof AppError ? error : new AppError('internal', error instanceof Error ? error.message : String(error));
  return new TRPCError({ code: TRPC_CODES[app.code], message: app.message, cause: app.details });
}

export async function callService<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toTrpcError(error);
  }
}

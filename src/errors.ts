export const ERROR_STATUS = {
  validation_failed: 400,
  unauthorized: 401,
  not_found: 404,
  policy_not_published: 404,
  conflict: 409,
  version_not_proposed: 409,
  stale_proposal: 409,
  not_a_pdf: 422,
  conversion_failed: 422,
  not_a_policy: 422,
  extraction_invalid: 422,
  rate_limited: 429,
  internal: 500,
  fetch_failed: 502,
  extraction_failed: 502,
  llm_not_configured: 503,
  ocr_not_configured: 503,
  storage_not_configured: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status() {
    return ERROR_STATUS[this.code];
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError('internal', error instanceof Error ? error.message : String(error));
}

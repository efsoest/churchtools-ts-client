/**
 * Error codes used by the ChurchTools core transport layer.
 */
export type ChurchToolsErrorCode = 'HTTP_ERROR' | 'REQUEST_ERROR' | 'TIMEOUT';

/**
 * Shared base error for all client-side transport/runtime failures.
 */
export class ChurchToolsClientError extends Error {
  readonly code: ChurchToolsErrorCode;
  override cause?: unknown;

  constructor(code: ChurchToolsErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ChurchToolsClientError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Error representing non-2xx HTTP responses.
 */
export class ChurchToolsHttpError extends ChurchToolsClientError {
  readonly response: Response;
  readonly status: number;
  readonly url: string;
  readonly method: string;

  constructor(params: {
    response: Response;
    url: string;
    method?: string;
    cause?: unknown;
  }) {
    const method = params.method ?? 'GET';
    const status = params.response.status;
    super(
      'HTTP_ERROR',
      `ChurchTools request failed with HTTP ${status} (${method} ${params.url}).`,
      params.cause,
    );
    this.name = 'ChurchToolsHttpError';
    this.response = params.response;
    this.status = status;
    this.url = params.url;
    this.method = method;
  }
}

/**
 * Error representing transport-level failures (network, DNS, aborted requests).
 */
export class ChurchToolsRequestError extends ChurchToolsClientError {
  readonly url: string;
  readonly method: string;

  constructor(params: {
    message: string;
    url: string;
    method?: string;
    cause?: unknown;
  }) {
    super('REQUEST_ERROR', params.message, params.cause);
    this.name = 'ChurchToolsRequestError';
    this.url = params.url;
    this.method = params.method ?? 'GET';
  }
}

/**
 * Error representing a client-side timeout triggered by `AbortController`.
 */
export class ChurchToolsTimeoutError extends ChurchToolsClientError {
  readonly timeoutMs: number;
  readonly url: string;
  readonly method: string;

  constructor(params: {
    timeoutMs: number;
    url: string;
    method?: string;
    cause?: unknown;
  }) {
    const method = params.method ?? 'GET';
    super(
      'TIMEOUT',
      `ChurchTools request timed out after ${params.timeoutMs}ms (${method} ${params.url}).`,
      params.cause,
    );
    this.name = 'ChurchToolsTimeoutError';
    this.timeoutMs = params.timeoutMs;
    this.url = params.url;
    this.method = method;
  }
}

/**
 * Type guard for Web/API abort errors.
 */
export const isAbortError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const namedError = error as { name?: unknown };
  return namedError.name === 'AbortError';
};

/**
 * Normalizes unknown transport errors to project-specific error classes.
 */
export const normalizeTransportError = (params: {
  error: unknown;
  url: string;
  method?: string;
  timeoutMs: number;
  timedOut: boolean;
}): ChurchToolsClientError => {
  const method = params.method ?? 'GET';

  if (params.error instanceof ChurchToolsClientError) {
    return params.error;
  }

  if (params.timedOut) {
    return new ChurchToolsTimeoutError({
      timeoutMs: params.timeoutMs,
      url: params.url,
      method,
      cause: params.error,
    });
  }

  if (isAbortError(params.error)) {
    return new ChurchToolsRequestError({
      message: `ChurchTools request was aborted (${method} ${params.url}).`,
      url: params.url,
      method,
      cause: params.error,
    });
  }

  if (params.error instanceof Error) {
    return new ChurchToolsRequestError({
      message: `ChurchTools request failed: ${params.error.message} (${method} ${params.url}).`,
      url: params.url,
      method,
      cause: params.error,
    });
  }

  return new ChurchToolsRequestError({
    message: `ChurchTools request failed with an unknown error (${method} ${params.url}).`,
    url: params.url,
    method,
    cause: params.error,
  });
};

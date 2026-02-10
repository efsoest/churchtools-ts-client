import type { ChurchToolsMiddleware } from './transport';

const STATUS_RATE_LIMITED = 429;
const DEFAULT_BASE_DELAY_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_BACKOFF_FACTOR = 2;
const DEFAULT_MAX_DELAY_MS = 120_000;
const DEFAULT_JITTER_RATIO = 0.1;

/**
 * Configuration for the `429 Too Many Requests` recovery middleware.
 */
export type ChurchToolsRateLimitOptions = {
  /**
   * Maximum number of retries after receiving 429.
   *
   * Default: `1`.
   */
  maxRetries?: number;
  /**
   * Base delay used for exponential backoff when `Retry-After` is absent.
   *
   * Default: `30000`.
   */
  baseDelayMs?: number;
  /**
   * Exponential factor per retry attempt.
   *
   * Default: `2`.
   */
  backoffFactor?: number;
  /**
   * Maximum effective delay for backoff calculation.
   *
   * Default: `120000`.
   */
  maxDelayMs?: number;
  /**
   * Relative randomization (`0` to `1`) applied to fallback delay.
   *
   * Default: `0.1`.
   */
  jitterRatio?: number;
};

type InternalRequestInit = RequestInit & {
  __ctRateLimitRetryAttempt?: number;
};

/**
 * Creates middleware that retries a request after `429 Too Many Requests`.
 *
 * Retry strategy:
 * - Use `Retry-After` header when provided by backend.
 * - Otherwise use exponential backoff with optional jitter.
 */
export const createRateLimitMiddleware = (
  options: ChurchToolsRateLimitOptions = {},
): ChurchToolsMiddleware | undefined => {
  const maxRetries = normalizeNonNegativeInteger(
    options.maxRetries,
    DEFAULT_MAX_RETRIES,
  );
  if (maxRetries <= 0) {
    return undefined;
  }

  const baseDelayMs = normalizePositiveNumber(
    options.baseDelayMs,
    DEFAULT_BASE_DELAY_MS,
  );
  const backoffFactor = normalizePositiveNumber(
    options.backoffFactor,
    DEFAULT_BACKOFF_FACTOR,
  );
  const maxDelayMs = normalizePositiveNumber(
    options.maxDelayMs,
    DEFAULT_MAX_DELAY_MS,
  );
  const jitterRatio = clamp(options.jitterRatio ?? DEFAULT_JITTER_RATIO, 0, 1);

  return {
    post: async (context) => {
      if (context.response.status !== STATUS_RATE_LIMITED) {
        return;
      }

      const attempt = getRetryAttempt(context.request.init);
      if (
        attempt >= maxRetries ||
        !isRetryableBody(context.request.init.body)
      ) {
        return;
      }

      const delayMs = getRetryDelayMs(context.response, {
        attempt,
        baseDelayMs,
        backoffFactor,
        maxDelayMs,
        jitterRatio,
      });
      await sleep(delayMs);

      const retryInit: InternalRequestInit = {
        ...context.request.init,
        __ctRateLimitRetryAttempt: attempt + 1,
      };
      if (context.request.init.headers) {
        retryInit.headers = new Headers(context.request.init.headers);
      }

      return context.fetch(context.request.url, retryInit);
    },
  };
};

const getRetryAttempt = (init: RequestInit): number => {
  const attempt = (init as InternalRequestInit).__ctRateLimitRetryAttempt;
  if (typeof attempt !== 'number' || !Number.isFinite(attempt)) {
    return 0;
  }
  return attempt;
};

const getRetryDelayMs = (
  response: Response,
  params: {
    attempt: number;
    baseDelayMs: number;
    backoffFactor: number;
    maxDelayMs: number;
    jitterRatio: number;
  },
): number => {
  const retryAfterMs = parseRetryAfterMs(response);
  if (retryAfterMs !== undefined) {
    return clamp(retryAfterMs, 0, params.maxDelayMs);
  }

  const exponential =
    params.baseDelayMs * params.backoffFactor ** params.attempt;
  const capped = Math.min(exponential, params.maxDelayMs);
  if (params.jitterRatio <= 0) {
    return capped;
  }

  const jitterRange = capped * params.jitterRatio;
  const randomized = capped + (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(randomized));
};

/**
 * Parses Retry-After either as delta-seconds or HTTP-date.
 */
const parseRetryAfterMs = (response: Response): number | undefined => {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) {
    return undefined;
  }

  const asSeconds = Number(retryAfter);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1_000);
  }

  const asDate = Date.parse(retryAfter);
  if (Number.isNaN(asDate)) {
    return undefined;
  }

  return asDate - Date.now();
};

const normalizeNonNegativeInteger = (
  value: number | undefined,
  fallback: number,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
};

const normalizePositiveNumber = (
  value: number | undefined,
  fallback: number,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Stream-backed request bodies are one-shot and cannot be retried safely.
 */
const isRetryableBody = (body: RequestInit['body']): boolean => {
  if (body === undefined || body === null) {
    return true;
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return false;
  }
  return true;
};

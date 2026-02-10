import type { ChurchToolsMiddleware, FetchLike } from './transport';

const DEFAULT_MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
const DEFAULT_HEADER_NAME = 'CSRF-Token';

type InternalRequestInit = RequestInit & {
  __ctSessionRetryAttempt?: number;
};

/**
 * Configuration for ChurchTools CSRF handling.
 */
export type ChurchToolsCsrfOptions = {
  /**
   * HTTP methods that should receive an automatic CSRF token.
   *
   * Default: `POST`, `PUT`, `PATCH`, `DELETE`.
   */
  methods?: string[];
  /**
   * Header name used to send the CSRF token.
   *
   * Default: `CSRF-Token`.
   */
  headerName?: string;
};

/**
 * Creates middleware that transparently injects a CSRF token for mutating
 * requests by loading `/api/csrftoken` once per session.
 */
export const createCsrfMiddleware = (config: {
  baseUrl: string;
  timeoutMs: number;
  credentials?: RequestCredentials;
  options?: ChurchToolsCsrfOptions;
}): ChurchToolsMiddleware => {
  const normalizedBaseUrl = config.baseUrl.replace(/\/+$/, '');
  const baseUrl = new URL(normalizedBaseUrl);
  const csrftokenEndpoint = `${normalizedBaseUrl}/api/csrftoken`;
  const methods = new Set(
    (config.options?.methods ?? DEFAULT_MUTATING_METHODS).map((method) =>
      method.toUpperCase(),
    ),
  );
  const headerName = config.options?.headerName ?? DEFAULT_HEADER_NAME;

  let cachedToken: string | undefined;
  let tokenInFlight: Promise<string | undefined> | undefined;

  const fetchCsrfToken = async (
    fetchApi: FetchLike,
  ): Promise<string | undefined> => {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(),
      config.timeoutMs,
    );

    const init: RequestInit = {
      method: 'GET',
      signal: timeoutController.signal,
      headers: {
        'X-OnlyAuthenticated': '1',
      },
    };
    if (config.credentials !== undefined) {
      init.credentials = config.credentials;
    }

    try {
      const response = await fetchApi(csrftokenEndpoint, init);
      if (response.status < 200 || response.status >= 300) {
        return undefined;
      }
      return await parseCsrfToken(response);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const resolveToken = async (
    forceRefresh: boolean,
    fetchApi: FetchLike,
  ): Promise<string | undefined> => {
    if (!forceRefresh && cachedToken) {
      return cachedToken;
    }

    if (!tokenInFlight) {
      tokenInFlight = fetchCsrfToken(fetchApi)
        .then((token) => {
          cachedToken = token;
          return token;
        })
        .finally(() => {
          tokenInFlight = undefined;
        });
    }
    return tokenInFlight;
  };

  return {
    pre: async (context) => {
      const requestUrl = toAbsoluteUrl(context.request.url, baseUrl);
      if (!requestUrl) {
        return context.request;
      }

      if (isCsrfTokenRequest(requestUrl.toString(), csrftokenEndpoint)) {
        return context.request;
      }

      /**
       * Security-critical guard:
       * CSRF tokens are session-bound secrets and must never be attached to
       * cross-origin requests.
       */
      if (requestUrl.origin !== baseUrl.origin) {
        return context.request;
      }

      const method = (context.request.init.method ?? 'GET').toUpperCase();
      if (!methods.has(method)) {
        return context.request;
      }

      const headers = new Headers(context.request.init.headers);
      if (headers.has(headerName)) {
        return context.request;
      }

      const forceRefresh = getSessionRetryAttempt(context.request.init) > 0;
      const token = await resolveToken(forceRefresh, context.fetch);
      if (!token) {
        return context.request;
      }

      headers.set(headerName, token);
      return {
        ...context.request,
        init: {
          ...context.request.init,
          headers,
        },
      };
    },
  };
};

const toAbsoluteUrl = (requestUrl: string, baseUrl: URL): URL | undefined => {
  try {
    return new URL(requestUrl, baseUrl);
  } catch {
    return undefined;
  }
};

const isCsrfTokenRequest = (
  requestUrl: string,
  csrftokenEndpoint: string,
): boolean => {
  return (
    requestUrl === '/api/csrftoken' ||
    requestUrl.startsWith('/api/csrftoken?') ||
    requestUrl === csrftokenEndpoint ||
    requestUrl.startsWith(`${csrftokenEndpoint}?`)
  );
};

const getSessionRetryAttempt = (init: RequestInit): number => {
  const attempt = (init as InternalRequestInit).__ctSessionRetryAttempt;
  if (typeof attempt !== 'number' || !Number.isFinite(attempt)) {
    return 0;
  }
  return attempt;
};

const parseCsrfToken = async (
  response: Response,
): Promise<string | undefined> => {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (contentType.includes('json')) {
    try {
      const payload = (await response.clone().json()) as
        | string
        | {
            data?: unknown;
            csrfToken?: unknown;
            token?: unknown;
          };

      if (typeof payload === 'string') {
        return toToken(payload);
      }

      if (payload && typeof payload === 'object') {
        if (typeof payload.data === 'string') {
          return toToken(payload.data);
        }
        if (typeof payload.csrfToken === 'string') {
          return toToken(payload.csrfToken);
        }
        if (typeof payload.token === 'string') {
          return toToken(payload.token);
        }
      }
    } catch {
      // Fall back to text parsing below.
    }
  }

  return toToken(await response.text());
};

const toToken = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null') {
    return undefined;
  }
  return trimmed;
};

import type {
  ChurchToolsFetchParams,
  ChurchToolsMiddleware,
  ChurchToolsResponseContext,
  FetchLike,
} from './transport';

/**
 * Supported login token providers for token-to-session login.
 */
export type ChurchToolsLoginTokenConfig =
  | string
  | Promise<string>
  | (() => string | Promise<string>);

/**
 * Configuration for ChurchTools session/auth middleware.
 */
export type ChurchToolsSessionAuthConfig = {
  /**
   * Normalized ChurchTools base URL without trailing slash.
   */
  baseUrl: string;
  /**
   * Timeout for middleware-initiated login requests.
   */
  timeoutMs: number;
  /**
   * Optional login token source. If omitted, auth middleware is disabled.
   */
  loginToken?: ChurchToolsLoginTokenConfig;
  /**
   * Optional user id forwarded to `/whoami`.
   */
  loginPersonId?: number;
  /**
   * Enables `with_session=true` on `/whoami` to force session creation.
   */
  forceSession?: boolean;
  /**
   * Optional fetch credentials mode for middleware-initiated login calls.
   */
  credentials?: RequestCredentials;
};

type InternalRequestInit = RequestInit & {
  __ctSessionRetryAttempt?: number;
};

const STATUS_UNAUTHORIZED = 401;
const SESSION_EXPIRED_MESSAGE = 'Session expired!';

/**
 * Creates middleware that implements ChurchTools-specific session behavior:
 *
 * 1. Token-to-session bridge via `/api/whoami?login_token=...`.
 * 2. Automatic `X-OnlyAuthenticated: 1` for non-`/whoami` requests.
 * 3. Transparent single retry for `401` and `200 + { message: "Session expired!" }`.
 */
export const createSessionAuthMiddleware = (
  config: ChurchToolsSessionAuthConfig,
): ChurchToolsMiddleware | undefined => {
  if (!config.loginToken) {
    return undefined;
  }

  const normalizedBaseUrl = config.baseUrl.replace(/\/+$/, '');
  const whoamiEndpoint = `${normalizedBaseUrl}/api/whoami`;

  let initialBridgeAttempted = false;
  let loginInFlight: Promise<boolean> | undefined;

  const resolveLoginToken = async (): Promise<string | undefined> => {
    const tokenConfig = config.loginToken;
    if (!tokenConfig) {
      return undefined;
    }
    const resolved =
      typeof tokenConfig === 'function'
        ? await tokenConfig()
        : await tokenConfig;
    return resolved || undefined;
  };

  const loginViaWhoami = async (fetchApi: FetchLike): Promise<boolean> => {
    const loginToken = await resolveLoginToken();
    if (!loginToken) {
      return false;
    }

    const queryParams = new URLSearchParams({
      login_token: loginToken,
      no_url_rewrite: 'true',
    });
    if (config.loginPersonId !== undefined) {
      queryParams.set('user_id', String(config.loginPersonId));
    }
    if (config.forceSession) {
      queryParams.set('with_session', 'true');
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(),
      config.timeoutMs,
    );

    const init: RequestInit = {
      method: 'GET',
      signal: timeoutController.signal,
      headers: {
        'X-OnlyAuthenticated': '0',
      },
    };
    if (config.credentials !== undefined) {
      init.credentials = config.credentials;
    }

    try {
      const response = await fetchApi(
        `${whoamiEndpoint}?${queryParams.toString()}`,
        init,
      );

      if (!isSuccessfulStatus(response.status)) {
        return false;
      }

      return !(await hasSessionExpiredPayload(response));
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  /**
   * Deduplicates concurrent login attempts so parallel requests share one
   * `/whoami` call and converge on the same session state.
   */
  const refreshSession = async (fetchApi: FetchLike): Promise<boolean> => {
    if (!loginInFlight) {
      loginInFlight = loginViaWhoami(fetchApi).finally(() => {
        loginInFlight = undefined;
      });
    }
    return loginInFlight;
  };

  const setAuthenticatedHeader = (
    request: ChurchToolsFetchParams,
  ): ChurchToolsFetchParams => {
    const headers = new Headers(request.init.headers);
    if (!headers.has('X-OnlyAuthenticated')) {
      headers.set('X-OnlyAuthenticated', '1');
    }
    return {
      ...request,
      init: {
        ...request.init,
        headers,
      },
    };
  };

  const retryAfterLogin = async (
    context: ChurchToolsResponseContext,
  ): Promise<Response | undefined> => {
    const retryAttempt = getRetryAttempt(context.request.init);
    if (retryAttempt >= 1 || !isRetryableBody(context.request.init.body)) {
      return undefined;
    }

    const refreshed = await refreshSession(context.fetch);
    if (!refreshed) {
      return undefined;
    }

    const retryInit: InternalRequestInit = {
      ...context.request.init,
      __ctSessionRetryAttempt: retryAttempt + 1,
    };
    if (context.request.init.headers) {
      const retryHeaders = new Headers(context.request.init.headers);
      /**
       * Let the cookie middleware rehydrate the latest session cookie after a
       * successful refresh. Reusing the stale header would pin the old session.
       */
      retryHeaders.delete('cookie');
      retryInit.headers = retryHeaders;
    }
    return context.fetch(context.request.url, retryInit);
  };

  return {
    pre: async (context) => {
      const isWhoami = isWhoamiRequest(context.request.url, whoamiEndpoint);

      if (!isWhoami) {
        if (!initialBridgeAttempted) {
          initialBridgeAttempted = true;
          // We intentionally do not fail the business request when initial login
          // bootstrap fails. Recovery is handled on unauthorized responses.
          await refreshSession(context.fetch);
        }
        return setAuthenticatedHeader(context.request);
      }

      return context.request;
    },
    post: async (context) => {
      if (isWhoamiRequest(context.request.url, whoamiEndpoint)) {
        return;
      }

      if (context.response.status === STATUS_UNAUTHORIZED) {
        return retryAfterLogin(context);
      }

      if (!(await hasSessionExpiredPayload(context.response))) {
        return;
      }

      const recoveredResponse = await retryAfterLogin(context);
      if (recoveredResponse) {
        return recoveredResponse;
      }

      return toUnauthorizedResponse(context.response);
    },
  };
};

const isWhoamiRequest = (
  requestUrl: string,
  whoamiEndpoint: string,
): boolean => {
  return (
    requestUrl === '/api/whoami' ||
    requestUrl.startsWith('/api/whoami?') ||
    requestUrl === whoamiEndpoint ||
    requestUrl.startsWith(`${whoamiEndpoint}?`)
  );
};

const getRetryAttempt = (init: RequestInit): number => {
  const attempt = (init as InternalRequestInit).__ctSessionRetryAttempt;
  if (typeof attempt !== 'number' || !Number.isFinite(attempt)) {
    return 0;
  }
  return attempt;
};

const isSuccessfulStatus = (status: number): boolean =>
  status >= 200 && status < 300;

/**
 * Fetch request bodies backed by streams are one-shot and cannot be retried
 * safely. Other common body shapes (JSON string, FormData, URLSearchParams)
 * are reusable.
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

/**
 * Detects the legacy ChurchTools auth sentinel:
 * `{ message: "Session expired!" }` with an HTTP 200 response.
 */
const hasSessionExpiredPayload = async (
  response: Response,
): Promise<boolean> => {
  if (response.status !== 200) {
    return false;
  }

  const contentType = response.headers.get('content-type');
  if (contentType && !contentType.toLowerCase().includes('json')) {
    return false;
  }

  try {
    const payload = (await response.clone().json()) as { message?: unknown };
    return payload.message === SESSION_EXPIRED_MESSAGE;
  } catch {
    return false;
  }
};

/**
 * Converts `200 + Session expired` responses into an unauthorized status so
 * the core transport error model stays consistent for callers.
 */
const toUnauthorizedResponse = async (
  response: Response,
): Promise<Response> => {
  const body = await response.clone().text();
  const headers = new Headers(response.headers);
  return new Response(body, {
    status: STATUS_UNAUTHORIZED,
    statusText: 'Unauthorized',
    headers,
  });
};

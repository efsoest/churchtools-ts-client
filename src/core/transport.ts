import { ChurchToolsHttpError, normalizeTransportError } from './errors';

/**
 * Runtime-agnostic fetch function signature used by the client.
 *
 * We intentionally avoid `typeof fetch` because Bun augments the global fetch
 * function with additional properties (for example `preconnect`) that are not
 * required by our transport abstraction.
 */
export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Local request object passed through middleware hooks.
 */
export type ChurchToolsFetchParams = {
  url: string;
  init: RequestInit;
};

/**
 * Context passed to pre-request middleware.
 */
export type ChurchToolsRequestContext = {
  fetch: FetchLike;
  request: ChurchToolsFetchParams;
};

/**
 * Context passed to post-response middleware.
 */
export type ChurchToolsResponseContext = {
  fetch: FetchLike;
  request: ChurchToolsFetchParams;
  response: Response;
};

/**
 * Context passed to error middleware.
 */
export type ChurchToolsErrorContext = {
  fetch: FetchLike;
  request: ChurchToolsFetchParams;
  error: unknown;
  response?: Response;
};

type MaybePromise<T> = T | Promise<T>;

/**
 * Middleware contract for the ChurchTools transport pipeline.
 */
export type ChurchToolsMiddleware = {
  pre?(
    context: ChurchToolsRequestContext,
  ): MaybePromise<ChurchToolsFetchParams | void>;
  post?(context: ChurchToolsResponseContext): MaybePromise<Response | void>;
  onError?(context: ChurchToolsErrorContext): MaybePromise<Response | void>;
};

/**
 * Configuration for transport creation.
 */
export type ChurchToolsTransportConfig = {
  fetchApi: FetchLike;
  timeoutMs: number;
  middleware?: ChurchToolsMiddleware[];
};

type CombinedSignal = {
  signal?: AbortSignal;
  timeoutSignal?: AbortSignal;
  dispose: () => void;
};

const abortSignalAny = (
  AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }
).any;

const getRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
};

/**
 * Combines an optional external signal with a timeout signal.
 *
 * - If timeout is disabled (`<= 0`), the original signal is reused.
 * - If `AbortSignal.any` is available, we use it directly.
 * - Otherwise, a manual fallback controller forwards abort events.
 */
const combineSignals = (
  sourceSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): CombinedSignal => {
  if (timeoutMs <= 0) {
    if (sourceSignal) {
      return {
        signal: sourceSignal,
        dispose: () => undefined,
      };
    }
    return {
      dispose: () => undefined,
    };
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort();
  }, timeoutMs);

  if (!sourceSignal) {
    return {
      signal: timeoutController.signal,
      timeoutSignal: timeoutController.signal,
      dispose: () => clearTimeout(timeoutId),
    };
  }

  if (abortSignalAny) {
    return {
      signal: abortSignalAny([sourceSignal, timeoutController.signal]),
      timeoutSignal: timeoutController.signal,
      dispose: () => clearTimeout(timeoutId),
    };
  }

  const combinedController = new AbortController();
  const forwardSourceAbort = () => {
    combinedController.abort();
  };
  const forwardTimeoutAbort = () => {
    combinedController.abort();
  };

  if (sourceSignal.aborted || timeoutController.signal.aborted) {
    combinedController.abort();
  } else {
    sourceSignal.addEventListener('abort', forwardSourceAbort, { once: true });
    timeoutController.signal.addEventListener('abort', forwardTimeoutAbort, {
      once: true,
    });
  }

  return {
    signal: combinedController.signal,
    timeoutSignal: timeoutController.signal,
    dispose: () => {
      clearTimeout(timeoutId);
      sourceSignal.removeEventListener('abort', forwardSourceAbort);
      timeoutController.signal.removeEventListener(
        'abort',
        forwardTimeoutAbort,
      );
    },
  };
};

const applyPreMiddleware = async (
  middleware: ChurchToolsMiddleware[],
  fetchApi: FetchLike,
  initial: ChurchToolsFetchParams,
): Promise<ChurchToolsFetchParams> => {
  let request = initial;

  for (const step of middleware) {
    if (!step.pre) {
      continue;
    }
    const overridden = await step.pre({ fetch: fetchApi, request });
    if (overridden) {
      request = overridden;
    }
  }

  return request;
};

const applyPostMiddleware = async (
  middleware: ChurchToolsMiddleware[],
  fetchApi: FetchLike,
  request: ChurchToolsFetchParams,
  initial: Response,
): Promise<Response> => {
  let response = initial;

  for (const step of middleware) {
    if (!step.post) {
      continue;
    }
    const overridden = await step.post({
      fetch: fetchApi,
      request,
      response: response.clone(),
    });
    if (overridden) {
      response = overridden;
    }
  }

  return response;
};

const applyErrorMiddleware = async (
  middleware: ChurchToolsMiddleware[],
  fetchApi: FetchLike,
  request: ChurchToolsFetchParams,
  error: unknown,
): Promise<Response | undefined> => {
  let recoveredResponse: Response | undefined;

  for (const step of middleware) {
    if (!step.onError) {
      continue;
    }

    const context: ChurchToolsErrorContext = recoveredResponse
      ? {
          fetch: fetchApi,
          request,
          error,
          response: recoveredResponse.clone(),
        }
      : {
          fetch: fetchApi,
          request,
          error,
        };

    const overridden = await step.onError(context);
    if (overridden) {
      recoveredResponse = overridden;
    }
  }

  return recoveredResponse;
};

const isSuccessResponse = (response: Response): boolean =>
  response.status >= 200 && response.status < 300;

const throwHttpError = (params: {
  response: Response;
  request: ChurchToolsFetchParams;
  fallbackMethod: string;
  cause?: unknown;
}): never => {
  throw new ChurchToolsHttpError({
    response: params.response,
    url: params.request.url,
    method: params.request.init.method ?? params.fallbackMethod,
    cause: params.cause,
  });
};

/**
 * Creates a fetch wrapper with:
 * - middleware hooks (`pre`, `post`, `onError`)
 * - timeout handling per request
 * - normalized project-specific errors
 */
export const createTransportFetch = (
  config: ChurchToolsTransportConfig,
): FetchLike => {
  const middleware = config.middleware ?? [];
  let wrappedFetch: FetchLike;

  wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const fallbackMethod = init?.method ?? 'GET';
    const signalState = combineSignals(init?.signal, config.timeoutMs);

    const requestInit: RequestInit = { ...init };
    if (signalState.signal) {
      requestInit.signal = signalState.signal;
    }

    let request: ChurchToolsFetchParams = {
      url: getRequestUrl(input),
      init: requestInit,
    };

    try {
      request = await applyPreMiddleware(middleware, wrappedFetch, request);

      const rawResponse = await config.fetchApi(request.url, request.init);
      const response = await applyPostMiddleware(
        middleware,
        wrappedFetch,
        request,
        rawResponse,
      );

      if (!isSuccessResponse(response)) {
        throwHttpError({
          response,
          request,
          fallbackMethod,
        });
      }

      return response;
    } catch (error) {
      const recoveredResponse = await applyErrorMiddleware(
        middleware,
        wrappedFetch,
        request,
        error,
      );

      if (recoveredResponse) {
        if (isSuccessResponse(recoveredResponse)) {
          return recoveredResponse;
        }
        throwHttpError({
          response: recoveredResponse,
          request,
          fallbackMethod,
          cause: error,
        });
      }

      throw normalizeTransportError({
        error,
        url: request.url,
        method: request.init.method ?? fallbackMethod,
        timeoutMs: config.timeoutMs,
        timedOut: Boolean(signalState.timeoutSignal?.aborted),
      });
    } finally {
      signalState.dispose();
    }
  };

  return wrappedFetch;
};

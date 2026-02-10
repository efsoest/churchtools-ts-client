import { ChurchToolsHttpError, normalizeTransportError } from './errors';

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Local fetch parameter object used in middleware hooks.
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

/**
 * Middleware contract for the ChurchTools core transport pipeline.
 */
export type ChurchToolsMiddleware = {
  pre?(
    context: ChurchToolsRequestContext,
  ): ChurchToolsFetchParams | void | Promise<ChurchToolsFetchParams | void>;
  post?(
    context: ChurchToolsResponseContext,
  ): Response | void | Promise<Response | void>;
  onError?(
    context: ChurchToolsErrorContext,
  ): Response | void | Promise<Response | void>;
};

/**
 * Configuration for the transport fetch wrapper.
 */
export type ChurchToolsTransportConfig = {
  fetchApi: FetchLike;
  timeoutMs: number;
  middleware?: ChurchToolsMiddleware[];
};

type CombinedSignal = {
  signal: AbortSignal | undefined;
  timeoutSignal: AbortSignal | undefined;
  dispose: () => void;
};

const abortSignalAny = (
  AbortSignal as unknown as {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }
).any;

const combineSignals = (
  sourceSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): CombinedSignal => {
  if (timeoutMs <= 0) {
    return {
      signal: sourceSignal ?? undefined,
      timeoutSignal: undefined,
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

  // Fallback for runtimes without AbortSignal.any
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

const toUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
};

/**
 * Creates a fetch wrapper that adds:
 * - pre/post/error middleware hooks
 * - client-side timeout handling via AbortController
 * - normalized project errors for HTTP/transport failures
 */
export const createTransportFetch = (
  config: ChurchToolsTransportConfig,
): FetchLike => {
  const middleware = config.middleware ?? [];
  let wrappedFetch: FetchLike;

  wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = toUrl(input);
    const requestMethod = init?.method ?? 'GET';

    const signalState = combineSignals(init?.signal, config.timeoutMs);
    const requestInit: RequestInit = { ...init };
    if (signalState.signal !== undefined) {
      requestInit.signal = signalState.signal;
    }

    let fetchParams: ChurchToolsFetchParams = {
      url: requestUrl,
      init: requestInit,
    };

    try {
      for (const step of middleware) {
        if (!step.pre) {
          continue;
        }
        const overridden = await step.pre({
          fetch: wrappedFetch,
          request: fetchParams,
        });
        if (overridden) {
          fetchParams = overridden;
        }
      }

      let response = await config.fetchApi(fetchParams.url, fetchParams.init);

      for (const step of middleware) {
        if (!step.post) {
          continue;
        }
        const overridden = await step.post({
          fetch: wrappedFetch,
          request: fetchParams,
          response: response.clone(),
        });
        if (overridden) {
          response = overridden;
        }
      }

      if (response.status < 200 || response.status >= 300) {
        throw new ChurchToolsHttpError({
          response,
          url: fetchParams.url,
          method: fetchParams.init.method ?? requestMethod,
        });
      }

      return response;
    } catch (error) {
      let recoveredResponse: Response | undefined;

      for (const step of middleware) {
        if (!step.onError) {
          continue;
        }
        const context: ChurchToolsErrorContext = recoveredResponse
          ? {
              fetch: wrappedFetch,
              request: fetchParams,
              error,
              response: recoveredResponse.clone(),
            }
          : {
              fetch: wrappedFetch,
              request: fetchParams,
              error,
            };
        const maybeRecovered = await step.onError(context);
        if (maybeRecovered) {
          recoveredResponse = maybeRecovered;
        }
      }

      if (recoveredResponse) {
        if (recoveredResponse.status >= 200 && recoveredResponse.status < 300) {
          return recoveredResponse;
        }
        throw new ChurchToolsHttpError({
          response: recoveredResponse,
          url: fetchParams.url,
          method: fetchParams.init.method ?? requestMethod,
          cause: error,
        });
      }

      throw normalizeTransportError({
        error,
        url: fetchParams.url,
        method: fetchParams.init.method ?? requestMethod,
        timeoutMs: config.timeoutMs,
        timedOut: Boolean(signalState.timeoutSignal?.aborted),
      });
    } finally {
      signalState.dispose();
    }
  };

  return wrappedFetch;
};

import {
  createTransportFetch,
  type ChurchToolsMiddleware,
  type ChurchToolsTransportConfig,
  type FetchLike,
} from './core/transport';
import {
  createSessionAuthMiddleware,
  type ChurchToolsLoginTokenConfig,
  type ChurchToolsSessionAuthConfig,
} from './core/auth';
import {
  createCookieSessionMiddleware,
  type ChurchToolsCookieOptions,
} from './core/cookies';
import { createCsrfMiddleware, type ChurchToolsCsrfOptions } from './core/csrf';
import {
  createRateLimitMiddleware,
  type ChurchToolsRateLimitOptions,
} from './core/rate-limit';

/**
 * Primitive value supported by query parameter serialization.
 */
type QueryPrimitive = string | number | boolean | null | undefined;

/**
 * Nested query object shape used by generated API classes.
 */
interface HTTPQuery {
  [key: string]:
    | QueryPrimitive
    | QueryPrimitive[]
    | Set<QueryPrimitive>
    | HTTPQuery;
}

/**
 * Flat object shape expected by generated runtime headers.
 */
type HTTPHeaders = Record<string, string>;

/**
 * Supported shapes for API key authentication configuration.
 */
type ApiKeyConfig =
  | string
  | Promise<string>
  | ((name: string) => string | Promise<string>);

/**
 * Supported shapes for access token authentication configuration.
 */
type AccessTokenConfig =
  | string
  | Promise<string>
  | ((name?: string, scopes?: string[]) => string | Promise<string>);

/**
 * Runtime config shape consumed by generated API classes.
 *
 * We keep this local type instead of importing generated runtime types directly,
 * so the handwritten layer stays decoupled from generated type strictness.
 */
export type ChurchToolsRuntimeConfiguration = {
  basePath: string;
  fetchApi: FetchLike;
  middleware: ChurchToolsMiddleware[];
  queryParamsStringify: (params: HTTPQuery) => string;
  headers?: HTTPHeaders;
  credentials?: RequestCredentials;
  apiKey?: (name: string) => string | Promise<string>;
  accessToken?: (name?: string, scopes?: string[]) => string | Promise<string>;
};

/**
 * Configuration accepted by `ChurchToolsClient`.
 */
export type ChurchToolsClientConfig = {
  /**
   * ChurchTools base URL without trailing slash, e.g. `https://example.church.tools`.
   */
  baseUrl: string;
  /**
   * Optional fetch implementation override.
   */
  fetch?: FetchLike;
  /**
   * Timeout for every request in milliseconds.
   *
   * Default: `15000`.
   */
  timeoutMs?: number;
  /**
   * Default headers sent with every generated API request.
   */
  headers?: HeadersInit;
  /**
   * Fetch credentials mode for every request.
   */
  credentials?: RequestCredentials;
  /**
   * API key source used by generated runtime auth handling.
   */
  apiKey?: ApiKeyConfig;
  /**
   * Access token source used by generated runtime auth handling.
   */
  accessToken?: AccessTokenConfig;
  /**
   * Optional ChurchTools login token used for `/whoami` session login.
   */
  loginToken?: ChurchToolsLoginTokenConfig;
  /**
   * Optional ChurchTools person id forwarded to `/whoami`.
   */
  loginPersonId?: number;
  /**
   * Adds `with_session=true` to `/whoami` to force backend session creation.
   */
  forceSession?: boolean;
  /**
   * Runtime-agnostic cookie/session handling.
   *
   * Use `false` to disable cookie middleware.
   */
  cookies?: ChurchToolsCookieOptions | false;
  /**
   * Configuration for automatic CSRF token handling on mutating requests.
   *
   * Use `false` to disable automatic CSRF handling.
   */
  csrf?: ChurchToolsCsrfOptions | false;
  /**
   * Configuration for automatic 429 backoff + retry.
   *
   * Use `false` to disable rate-limit retries completely.
   */
  rateLimit?: ChurchToolsRateLimitOptions | false;
  /**
   * Transport middleware hooks executed around every request.
   */
  middleware?: ChurchToolsMiddleware[];
};

/**
 * Constructor contract for generated API classes.
 */
export type ChurchToolsApiConstructor<TApi> = new (
  configuration?: unknown,
) => TApi;

/**
 * Main entrypoint for consumers of the ChurchTools client package.
 *
 * Responsibilities:
 * - normalize base configuration
 * - create a wrapped fetch transport with middleware + timeout + error handling
 * - provide runtime configuration for generated API classes
 */
export class ChurchToolsClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #configuration: ChurchToolsRuntimeConfiguration;

  constructor(config: ChurchToolsClientConfig) {
    if (!config.baseUrl) {
      throw new Error('`baseUrl` is required.');
    }

    this.#baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.#timeoutMs = config.timeoutMs ?? 15_000;
    this.#fetch = createClientFetch(config, {
      baseUrl: this.#baseUrl,
      timeoutMs: this.#timeoutMs,
    });
    this.#configuration = createRuntimeConfiguration(config, {
      baseUrl: this.#baseUrl,
      fetchApi: this.#fetch,
    });
  }

  /**
   * Normalized base URL without trailing slash.
   */
  get baseUrl(): string {
    return this.#baseUrl;
  }

  /**
   * Active request timeout in milliseconds.
   */
  get timeoutMs(): number {
    return this.#timeoutMs;
  }

  /**
   * Wrapped fetch implementation used by generated APIs.
   */
  get fetchImpl(): FetchLike {
    return this.#fetch;
  }

  /**
   * Low-level runtime configuration that can be reused directly if needed.
   */
  get configuration(): ChurchToolsRuntimeConfiguration {
    return this.#configuration;
  }

  /**
   * Instantiates a generated API class with the client runtime configuration.
   *
   * Example:
   * `const personApi = client.api(PersonApi)`.
   */
  api<TApi>(ApiClass: ChurchToolsApiConstructor<TApi>): TApi {
    return new ApiClass(this.#configuration);
  }
}

const createClientFetch = (
  config: ChurchToolsClientConfig,
  params: {
    baseUrl: string;
    timeoutMs: number;
  },
): FetchLike => {
  const fetchApi = config.fetch ?? fetch;
  const middleware: ChurchToolsMiddleware[] = [];

  const sessionAuthConfig: ChurchToolsSessionAuthConfig = {
    baseUrl: params.baseUrl,
    timeoutMs: params.timeoutMs,
  };
  if (config.loginToken !== undefined) {
    sessionAuthConfig.loginToken = config.loginToken;
  }
  if (config.loginPersonId !== undefined) {
    sessionAuthConfig.loginPersonId = config.loginPersonId;
  }
  if (config.forceSession !== undefined) {
    sessionAuthConfig.forceSession = config.forceSession;
  }
  if (config.credentials !== undefined) {
    sessionAuthConfig.credentials = config.credentials;
  }

  const sessionAuthMiddleware = createSessionAuthMiddleware(sessionAuthConfig);
  if (sessionAuthMiddleware) {
    middleware.push(sessionAuthMiddleware);
  }
  if (config.cookies !== false) {
    const cookieConfig: {
      baseUrl: string;
      options?: ChurchToolsCookieOptions;
    } = {
      baseUrl: params.baseUrl,
    };
    if (config.cookies !== undefined) {
      cookieConfig.options = config.cookies;
    }

    const cookieMiddleware = createCookieSessionMiddleware(cookieConfig);
    if (cookieMiddleware) {
      middleware.push(cookieMiddleware);
    }
  }
  if (config.csrf !== false) {
    const csrfConfig: {
      baseUrl: string;
      timeoutMs: number;
      credentials?: RequestCredentials;
      options?: ChurchToolsCsrfOptions;
    } = {
      baseUrl: params.baseUrl,
      timeoutMs: params.timeoutMs,
    };
    if (config.credentials !== undefined) {
      csrfConfig.credentials = config.credentials;
    }
    if (config.csrf !== undefined) {
      csrfConfig.options = config.csrf;
    }

    const csrfMiddleware = createCsrfMiddleware(csrfConfig);
    middleware.push(csrfMiddleware);
  }
  if (config.rateLimit !== false) {
    const rateLimitMiddleware = createRateLimitMiddleware(config.rateLimit);
    if (rateLimitMiddleware) {
      middleware.push(rateLimitMiddleware);
    }
  }
  if (config.middleware) {
    middleware.push(...config.middleware);
  }

  const transportConfig: ChurchToolsTransportConfig = {
    fetchApi,
    timeoutMs: params.timeoutMs,
    middleware,
  };
  return createTransportFetch(transportConfig);
};

const createRuntimeConfiguration = (
  config: ChurchToolsClientConfig,
  params: {
    baseUrl: string;
    fetchApi: FetchLike;
  },
): ChurchToolsRuntimeConfiguration => {
  const runtimeConfig: ChurchToolsRuntimeConfiguration = {
    basePath: `${params.baseUrl}/api`,
    fetchApi: params.fetchApi,
    middleware: [],
    queryParamsStringify: querystring,
  };

  const runtimeHeaders = toHttpHeaders(config.headers);
  if (runtimeHeaders) {
    runtimeConfig.headers = runtimeHeaders;
  }
  if (config.credentials !== undefined) {
    runtimeConfig.credentials = config.credentials;
  }
  if (config.apiKey !== undefined) {
    runtimeConfig.apiKey = asApiKeyResolver(config.apiKey);
  }
  if (config.accessToken !== undefined) {
    runtimeConfig.accessToken = asAccessTokenResolver(config.accessToken);
  }

  return runtimeConfig;
};

const asApiKeyResolver = (
  apiKey: ApiKeyConfig,
): ((name: string) => string | Promise<string>) => {
  if (typeof apiKey === 'function') {
    return apiKey;
  }
  return () => apiKey;
};

const asAccessTokenResolver = (
  accessToken: AccessTokenConfig,
): ((name?: string, scopes?: string[]) => string | Promise<string>) => {
  if (typeof accessToken === 'function') {
    return accessToken;
  }
  return async () => accessToken;
};

/**
 * Converts any `HeadersInit` shape to a plain object expected by generated runtime.
 */
const toHttpHeaders = (
  headers: HeadersInit | undefined,
): HTTPHeaders | undefined => {
  if (!headers) {
    return undefined;
  }

  const normalized = new Headers(headers);
  const asObject: HTTPHeaders = {};
  normalized.forEach((value, key) => {
    asObject[key] = value;
  });
  return asObject;
};

/**
 * Query serializer compatible with the generated runtime expectations.
 */
const querystring = (params: HTTPQuery, prefix = ''): string => {
  return Object.keys(params)
    .map((key) => querystringSingleKey(key, params[key], prefix))
    .filter((part) => part.length > 0)
    .join('&');
};

const querystringSingleKey = (
  key: string,
  value: HTTPQuery[keyof HTTPQuery],
  keyPrefix = '',
): string => {
  const fullKey = keyPrefix + (keyPrefix.length > 0 ? `[${key}]` : key);

  if (value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    const encodedValues = value
      .map((single) => encodeURIComponent(String(single)))
      .join(`&${encodeURIComponent(fullKey)}=`);
    return `${encodeURIComponent(fullKey)}=${encodedValues}`;
  }

  if (value instanceof Set) {
    return querystringSingleKey(key, Array.from(value), keyPrefix);
  }

  if (value instanceof Date) {
    return `${encodeURIComponent(fullKey)}=${encodeURIComponent(value.toISOString())}`;
  }

  if (typeof value === 'object' && value !== null) {
    return querystring(value as HTTPQuery, fullKey);
  }

  return `${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`;
};

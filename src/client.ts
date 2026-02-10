import {
  createTransportFetch,
  type ChurchToolsMiddleware,
  type ChurchToolsTransportConfig,
  type FetchLike,
} from './core/transport';

type QueryPrimitive = string | number | boolean | null | undefined;
interface HTTPQuery {
  [key: string]:
    | QueryPrimitive
    | QueryPrimitive[]
    | Set<QueryPrimitive>
    | HTTPQuery;
}
type HTTPHeaders = Record<string, string>;

type ApiKeyConfig =
  | string
  | Promise<string>
  | ((name: string) => string | Promise<string>);

type AccessTokenConfig =
  | string
  | Promise<string>
  | ((name?: string, scopes?: string[]) => string | Promise<string>);

type ChurchToolsRuntimeConfiguration = {
  basePath: string;
  fetchApi: FetchLike;
  middleware: ChurchToolsMiddleware[];
  queryParamsStringify: (params: HTTPQuery) => string;
  headers?: HTTPHeaders;
  credentials?: RequestCredentials;
  apiKey?: (name: string) => string | Promise<string>;
  accessToken?: (name?: string, scopes?: string[]) => string | Promise<string>;
};

export type ChurchToolsClientConfig = {
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  apiKey?: ApiKeyConfig;
  accessToken?: AccessTokenConfig;
  middleware?: ChurchToolsMiddleware[];
};

export type ChurchToolsApiConstructor<TApi> = new (configuration?: any) => TApi;

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

    const transportConfig: ChurchToolsTransportConfig = {
      fetchApi: config.fetch ?? fetch,
      timeoutMs: this.#timeoutMs,
    };
    if (config.middleware) {
      transportConfig.middleware = config.middleware;
    }
    this.#fetch = createTransportFetch(transportConfig);

    const runtimeConfig: ChurchToolsRuntimeConfiguration = {
      basePath: `${this.#baseUrl}/api`,
      fetchApi: this.#fetch,
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

    this.#configuration = runtimeConfig;
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  get timeoutMs(): number {
    return this.#timeoutMs;
  }

  get fetchImpl(): FetchLike {
    return this.#fetch;
  }

  /**
   * Low-level runtime configuration passed to generated API classes.
   */
  get configuration(): ChurchToolsRuntimeConfiguration {
    return this.#configuration;
  }

  /**
   * Creates any generated API class with the configured core transport pipeline.
   */
  api<TApi>(ApiClass: ChurchToolsApiConstructor<TApi>): TApi {
    return new ApiClass(this.#configuration);
  }
}

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
    const encoded = value
      .map((single) => encodeURIComponent(String(single)))
      .join(`&${encodeURIComponent(fullKey)}=`);
    return `${encodeURIComponent(fullKey)}=${encoded}`;
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

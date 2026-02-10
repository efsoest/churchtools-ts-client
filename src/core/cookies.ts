import type { ChurchToolsMiddleware } from './transport';

type MaybePromise<T> = T | Promise<T>;

type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  /**
   * Host-only cookies (no Domain attribute) must be sent only to the exact host.
   */
  hostOnly: boolean;
  path: string;
  secure: boolean;
  expiresAt?: number;
};

/**
 * Cookie storage abstraction for runtime-agnostic session handling.
 *
 * Implementations can persist cookies in-memory, in files, or via external
 * cookie-jar libraries.
 */
export type ChurchToolsCookieStore = {
  getCookieHeader(url: string): MaybePromise<string | undefined>;
  setCookies(url: string, setCookieHeaders: string[]): MaybePromise<void>;
};

/**
 * Options for cookie/session middleware.
 */
export type ChurchToolsCookieOptions = {
  /**
   * Custom cookie store implementation.
   *
   * If omitted, an in-memory store is used.
   */
  store?: ChurchToolsCookieStore;
  /**
   * Runtime mode:
   * - `auto` (default): browser => no middleware, non-browser => middleware on.
   * - `manual`: always use middleware.
   */
  mode?: 'auto' | 'manual';
};

/**
 * Simple RFC-6265 oriented in-memory cookie store.
 */
export class InMemoryCookieStore implements ChurchToolsCookieStore {
  readonly #cookies = new Map<string, StoredCookie>();

  async getCookieHeader(url: string): Promise<string | undefined> {
    const requestUrl = tryParseUrl(url);
    if (!requestUrl) {
      return undefined;
    }

    const now = Date.now();
    const matchingCookies: StoredCookie[] = [];
    for (const [key, cookie] of this.#cookies) {
      if (isExpired(cookie, now)) {
        this.#cookies.delete(key);
        continue;
      }
      if (!domainMatches(requestUrl.hostname, cookie)) {
        continue;
      }
      if (!pathMatches(requestUrl.pathname, cookie.path)) {
        continue;
      }
      if (cookie.secure && requestUrl.protocol !== 'https:') {
        continue;
      }
      matchingCookies.push(cookie);
    }

    if (matchingCookies.length === 0) {
      return undefined;
    }

    matchingCookies.sort((left, right) => right.path.length - left.path.length);
    return matchingCookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }

  async setCookies(url: string, setCookieHeaders: string[]): Promise<void> {
    const requestUrl = tryParseUrl(url);
    if (!requestUrl) {
      return;
    }

    const now = Date.now();
    for (const rawSetCookie of setCookieHeaders) {
      const parsed = parseSetCookie(rawSetCookie, requestUrl, now);
      if (!parsed) {
        continue;
      }

      const key = getCookieStorageKey(parsed);
      if (isExpired(parsed, now) || parsed.value.length === 0) {
        this.#cookies.delete(key);
        continue;
      }

      this.#cookies.set(key, parsed);
    }
  }
}

/**
 * Creates middleware that captures `Set-Cookie` and replays `Cookie` headers
 * on subsequent requests in non-browser runtimes.
 */
export const createCookieSessionMiddleware = (config: {
  baseUrl: string;
  options?: ChurchToolsCookieOptions;
}): ChurchToolsMiddleware | undefined => {
  const runtimeMode = config.options?.mode ?? 'auto';
  if (runtimeMode === 'auto' && isBrowserRuntime()) {
    return undefined;
  }

  const baseUrl = new URL(config.baseUrl);
  const store = config.options?.store ?? new InMemoryCookieStore();

  return {
    pre: async (context) => {
      const requestUrl = toAbsoluteUrl(context.request.url, baseUrl);
      if (!requestUrl || requestUrl.origin !== baseUrl.origin) {
        return;
      }
      /**
       * Security-critical guard:
       * `credentials: 'omit'` is an explicit caller intent to avoid ambient
       * authentication state. The middleware must not attach session cookies.
       */
      if (context.request.init.credentials === 'omit') {
        return;
      }

      const headers = new Headers(context.request.init.headers);
      if (headers.has('cookie')) {
        return;
      }

      const cookieHeader = await store.getCookieHeader(requestUrl.toString());
      if (!cookieHeader) {
        return;
      }

      headers.set('Cookie', cookieHeader);
      return {
        ...context.request,
        init: {
          ...context.request.init,
          headers,
        },
      };
    },
    post: async (context) => {
      const requestUrl = toAbsoluteUrl(context.request.url, baseUrl);
      if (!requestUrl || requestUrl.origin !== baseUrl.origin) {
        return;
      }
      /**
       * Security-critical guard:
       * when callers opt out of credentials for a request, the middleware should
       * not persist `Set-Cookie` as a side effect of that request.
       */
      if (context.request.init.credentials === 'omit') {
        return;
      }

      const setCookieHeaders = extractSetCookieHeaders(context.response);
      if (setCookieHeaders.length === 0) {
        return;
      }

      await store.setCookies(requestUrl.toString(), setCookieHeaders);
    },
  };
};

const isBrowserRuntime = (): boolean =>
  typeof window !== 'undefined' && typeof window.document !== 'undefined';

const toAbsoluteUrl = (requestUrl: string, baseUrl: URL): URL | undefined => {
  try {
    return new URL(requestUrl, baseUrl);
  } catch {
    return undefined;
  }
};

const tryParseUrl = (url: string): URL | undefined => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

const extractSetCookieHeaders = (response: Response): string[] => {
  const responseHeaders = response.headers as Headers & {
    getSetCookie?: () => string[];
    raw?: () => Record<string, string[]>;
  };

  if (typeof responseHeaders.getSetCookie === 'function') {
    return responseHeaders
      .getSetCookie()
      .filter((entry) => entry.trim().length > 0);
  }

  if (typeof responseHeaders.raw === 'function') {
    const rawHeaders = responseHeaders.raw();
    const setCookie = rawHeaders['set-cookie'];
    if (Array.isArray(setCookie)) {
      return setCookie.filter((entry) => entry.trim().length > 0);
    }
  }

  const singleHeader = response.headers.get('set-cookie');
  if (!singleHeader) {
    return [];
  }
  return splitCombinedSetCookieHeader(singleHeader);
};

/**
 * Fallback splitter for runtimes that expose only a single comma-joined
 * `set-cookie` header string.
 */
const splitCombinedSetCookieHeader = (headerValue: string): string[] => {
  const result: string[] = [];
  let start = 0;
  let inExpiresAttribute = false;

  for (let index = 0; index < headerValue.length; index += 1) {
    const char = headerValue[index];

    if (
      (char === 'e' || char === 'E') &&
      headerValue.slice(index, index + 8).toLowerCase() === 'expires='
    ) {
      inExpiresAttribute = true;
      index += 7;
      continue;
    }

    if (char === ';' && inExpiresAttribute) {
      inExpiresAttribute = false;
      continue;
    }

    if (char === ',' && !inExpiresAttribute) {
      const cookie = headerValue.slice(start, index).trim();
      if (cookie.length > 0) {
        result.push(cookie);
      }
      start = index + 1;
    }
  }

  const trailing = headerValue.slice(start).trim();
  if (trailing.length > 0) {
    result.push(trailing);
  }

  return result;
};

const parseSetCookie = (
  rawSetCookie: string,
  requestUrl: URL,
  now: number,
): StoredCookie | undefined => {
  const segments = rawSetCookie
    .split(';')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return undefined;
  }

  const firstSegment = segments[0];
  if (!firstSegment) {
    return undefined;
  }

  const pairIndex = firstSegment.indexOf('=');
  if (pairIndex <= 0) {
    return undefined;
  }

  const name = firstSegment.slice(0, pairIndex).trim();
  const value = firstSegment.slice(pairIndex + 1).trim();
  if (!name) {
    return undefined;
  }

  const cookie: StoredCookie = {
    name,
    value,
    domain: requestUrl.hostname.toLowerCase(),
    hostOnly: true,
    path: defaultCookiePath(requestUrl.pathname),
    secure: false,
  };

  let maxAgeSeconds: number | undefined;

  for (const attribute of segments.slice(1)) {
    const equalsIndex = attribute.indexOf('=');
    const attributeName =
      equalsIndex === -1
        ? attribute.toLowerCase()
        : attribute.slice(0, equalsIndex).trim().toLowerCase();
    const attributeValue =
      equalsIndex === -1 ? '' : attribute.slice(equalsIndex + 1).trim();

    switch (attributeName) {
      case 'domain':
        if (attributeValue.length > 0) {
          cookie.domain = normalizeDomain(attributeValue);
          /**
           * Security-relevant scope separation:
           * explicit Domain creates a domain-cookie (subdomains allowed),
           * missing Domain keeps the cookie host-only.
           */
          cookie.hostOnly = false;
        }
        break;
      case 'path':
        if (attributeValue.length > 0) {
          cookie.path = attributeValue.startsWith('/') ? attributeValue : '/';
        }
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'max-age': {
        const parsedMaxAge = Number(attributeValue);
        if (Number.isFinite(parsedMaxAge)) {
          maxAgeSeconds = parsedMaxAge;
        }
        break;
      }
      case 'expires': {
        const parsedExpires = Date.parse(attributeValue);
        if (!Number.isNaN(parsedExpires)) {
          cookie.expiresAt = parsedExpires;
        }
        break;
      }
    }
  }

  if (maxAgeSeconds !== undefined) {
    cookie.expiresAt = now + maxAgeSeconds * 1_000;
  }

  return cookie;
};

const normalizeDomain = (domain: string): string =>
  domain.trim().toLowerCase().replace(/^\./, '');

const defaultCookiePath = (pathname: string): string => {
  if (!pathname || !pathname.startsWith('/')) {
    return '/';
  }
  if (pathname === '/') {
    return '/';
  }
  const lastSlashIndex = pathname.lastIndexOf('/');
  if (lastSlashIndex <= 0) {
    return '/';
  }
  return pathname.slice(0, lastSlashIndex);
};

const getCookieStorageKey = (cookie: StoredCookie): string =>
  `${cookie.domain}|${cookie.hostOnly ? 'host' : 'domain'}|${cookie.path}|${cookie.name}`;

const isExpired = (cookie: StoredCookie, now: number): boolean =>
  cookie.expiresAt !== undefined && cookie.expiresAt <= now;

const domainMatches = (host: string, cookie: StoredCookie): boolean => {
  const normalizedHost = host.toLowerCase();
  const normalizedDomain = normalizeDomain(cookie.domain);
  /**
   * Security-critical behavior:
   * host-only cookies must never be sent to subdomains.
   */
  if (cookie.hostOnly) {
    return normalizedHost === normalizedDomain;
  }
  return (
    normalizedHost === normalizedDomain ||
    normalizedHost.endsWith(`.${normalizedDomain}`)
  );
};

const pathMatches = (requestPath: string, cookiePath: string): boolean => {
  if (requestPath === cookiePath) {
    return true;
  }
  if (!requestPath.startsWith(cookiePath)) {
    return false;
  }
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
};

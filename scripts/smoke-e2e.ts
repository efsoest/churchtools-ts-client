import {
  ChurchToolsClient,
  ChurchToolsHttpError,
  type ChurchToolsClientConfig,
} from '../src';
import type { ChurchToolsMiddleware } from '../src';

type RequestTrace = {
  method: string;
  url: string;
  hasOnlyAuthenticatedHeader: boolean;
  hasCookieHeader: boolean;
  hasCsrfTokenHeader: boolean;
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
};

const parsePositiveInt = (
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const normalizePath = (value: string): string => {
  if (value.startsWith('/')) {
    return value;
  }
  return `/${value}`;
};

const sanitizeUrl = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has('login_token')) {
      parsed.searchParams.set('login_token', '***');
    }
    return parsed.toString();
  } catch {
    return rawUrl.replace(/login_token=[^&]+/g, 'login_token=***');
  }
};

const assertOrThrow = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(`Smoke check failed: ${message}`);
  }
};

const baseUrl = requireEnv('CT_BASE_URL').replace(/\/+$/, '');
const loginToken = requireEnv('CT_LOGIN_TOKEN');
const loginPersonIdRaw = process.env.CT_LOGIN_PERSON_ID?.trim();
const loginPersonId =
  loginPersonIdRaw && Number.isFinite(Number(loginPersonIdRaw))
    ? Number(loginPersonIdRaw)
    : undefined;
const timeoutMs = parsePositiveInt(process.env.CT_TIMEOUT_MS, 15_000);
const mutationPath = normalizePath(
  process.env.CT_SMOKE_MUTATION_PATH?.trim() ?? '/api/whoami',
);
const mutationBody = process.env.CT_SMOKE_MUTATION_BODY ?? '{}';

const traces: RequestTrace[] = [];

const tracingMiddleware: ChurchToolsMiddleware = {
  pre: async (context) => {
    const headers = new Headers(context.request.init.headers);
    traces.push({
      method: (context.request.init.method ?? 'GET').toUpperCase(),
      url: sanitizeUrl(context.request.url),
      hasOnlyAuthenticatedHeader: headers.has('x-onlyauthenticated'),
      hasCookieHeader: headers.has('cookie'),
      hasCsrfTokenHeader: headers.has('csrf-token'),
    });
    return context.request;
  },
};

const clientConfig: ChurchToolsClientConfig = {
  baseUrl,
  timeoutMs,
  loginToken,
  forceSession: true,
  cookies: { mode: 'manual' },
  csrf: {},
  rateLimit: false,
  middleware: [tracingMiddleware],
};
if (loginPersonId !== undefined) {
  clientConfig.loginPersonId = loginPersonId;
}

const client = new ChurchToolsClient(clientConfig);

const run = async (): Promise<void> => {
  console.log('[smoke-e2e] starting');
  console.log(`[smoke-e2e] baseUrl: ${baseUrl}`);
  console.log(`[smoke-e2e] timeoutMs: ${timeoutMs}`);
  console.log(`[smoke-e2e] mutationPath: ${mutationPath}`);

  const csrfResponse = await client.fetchImpl(`${baseUrl}/api/csrftoken`, {
    method: 'GET',
  });
  console.log(`[smoke-e2e] GET /api/csrftoken -> ${csrfResponse.status}`);

  const whoamiResponse = await client.fetchImpl(`${baseUrl}/api/whoami`, {
    method: 'GET',
  });
  console.log(`[smoke-e2e] GET /api/whoami -> ${whoamiResponse.status}`);

  try {
    await client.fetchImpl(`${baseUrl}${mutationPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: mutationBody,
    });
    console.log(`[smoke-e2e] POST ${mutationPath} -> 2xx`);
  } catch (error) {
    if (error instanceof ChurchToolsHttpError) {
      console.log(
        `[smoke-e2e] POST ${mutationPath} -> HTTP ${error.status} (accepted for smoke pipeline validation)`,
      );
    } else {
      throw error;
    }
  }

  const hasWhoamiBridge = traces.some(
    (trace) =>
      trace.url.includes('/api/whoami?') &&
      trace.url.includes('login_token=***'),
  );
  assertOrThrow(
    hasWhoamiBridge,
    'no login_token whoami bridge request was observed',
  );

  const csrfGetTrace = traces.find(
    (trace) => trace.method === 'GET' && trace.url.includes('/api/csrftoken'),
  );
  assertOrThrow(csrfGetTrace, 'no GET /api/csrftoken request was observed');
  assertOrThrow(
    csrfGetTrace?.hasOnlyAuthenticatedHeader,
    'GET /api/csrftoken did not include X-OnlyAuthenticated',
  );

  const mutationTrace = [...traces]
    .reverse()
    .find(
      (trace) =>
        trace.method === 'POST' &&
        trace.url.includes(mutationPath.replace(/^\/api/, '/api')),
    );
  assertOrThrow(
    mutationTrace,
    `no POST ${mutationPath} request was observed in trace`,
  );
  assertOrThrow(
    mutationTrace?.hasCsrfTokenHeader,
    `POST ${mutationPath} did not include CSRF-Token`,
  );
  assertOrThrow(
    mutationTrace?.hasCookieHeader,
    `POST ${mutationPath} did not include Cookie header`,
  );

  console.log('[smoke-e2e] checks passed');
  console.log('[smoke-e2e] request trace:');
  for (const trace of traces) {
    console.log(
      `  - ${trace.method} ${trace.url} | x-only-auth=${trace.hasOnlyAuthenticatedHeader} cookie=${trace.hasCookieHeader} csrf=${trace.hasCsrfTokenHeader}`,
    );
  }
};

await run();

import { describe, expect, test } from 'bun:test';

import { ChurchToolsClient } from '../../src/client';
import type { FetchLike } from '../../src/core/transport';

type InternalRequestInit = RequestInit & {
  __ctSessionRetryAttempt?: number;
};

describe('integration core pipeline', () => {
  test('bootstraps session + csrf for first mutating request', async () => {
    const calls: string[] = [];
    let whoamiCalls = 0;

    const fetchMock: FetchLike = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);

      if (url.startsWith('https://example.test/api/whoami')) {
        whoamiCalls += 1;
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': 'ct_session=initial; Path=/; HttpOnly',
          },
        });
      }

      if (url === 'https://example.test/api/csrftoken') {
        const headers = new Headers(init?.headers);
        expect(headers.get('cookie')).toContain('ct_session=initial');
        expect(headers.get('x-onlyauthenticated')).toBe('1');
        return new Response('csrf-token-1', { status: 200 });
      }

      if (url === 'https://example.test/api/files') {
        const headers = new Headers(init?.headers);
        expect(headers.get('cookie')).toContain('ct_session=initial');
        expect(headers.get('x-onlyauthenticated')).toBe('1');
        expect(headers.get('csrf-token')).toBe('csrf-token-1');
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        });
      }

      throw new Error(`Unexpected request URL: ${url}`);
    };

    const client = new ChurchToolsClient({
      baseUrl: 'https://example.test',
      fetch: fetchMock,
      timeoutMs: 250,
      loginToken: 'token-123',
      cookies: {
        mode: 'manual',
      },
      csrf: {},
      rateLimit: false,
    });

    const response = await client.fetchImpl('https://example.test/api/files', {
      method: 'POST',
      body: JSON.stringify({ id: 1 }),
    });

    expect(response.status).toBe(200);
    expect(whoamiCalls).toBe(1);
    expect(calls).toEqual([
      'https://example.test/api/whoami?login_token=token-123&no_url_rewrite=true',
      'https://example.test/api/csrftoken',
      'https://example.test/api/files',
    ]);
  });

  test('refreshes session and csrf token on 401 retry flow', async () => {
    let whoamiCalls = 0;
    let csrfCalls = 0;
    const fileAttempts: Array<{
      cookie: string | null;
      csrfToken: string | null;
      retryAttempt?: number;
      authenticatedHeader: string | null;
    }> = [];

    const fetchMock: FetchLike = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.startsWith('https://example.test/api/whoami')) {
        whoamiCalls += 1;
        const sessionName = whoamiCalls === 1 ? 'initial' : 'renewed';
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': `ct_session=${sessionName}; Path=/; HttpOnly`,
          },
        });
      }

      if (url === 'https://example.test/api/csrftoken') {
        csrfCalls += 1;
        return new Response(`csrf-token-${csrfCalls}`, { status: 200 });
      }

      if (url === 'https://example.test/api/files') {
        const headers = new Headers(init?.headers);
        const attempt: {
          cookie: string | null;
          csrfToken: string | null;
          retryAttempt?: number;
          authenticatedHeader: string | null;
        } = {
          cookie: headers.get('cookie'),
          csrfToken: headers.get('csrf-token'),
          authenticatedHeader: headers.get('x-onlyauthenticated'),
        };
        const retryAttempt = (init as InternalRequestInit)
          ?.__ctSessionRetryAttempt;
        if (retryAttempt !== undefined) {
          attempt.retryAttempt = retryAttempt;
        }
        fileAttempts.push(attempt);

        if (fileAttempts.length === 1) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: {
              'content-type': 'application/json',
            },
          });
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        });
      }

      throw new Error(`Unexpected request URL: ${url}`);
    };

    const client = new ChurchToolsClient({
      baseUrl: 'https://example.test',
      fetch: fetchMock,
      timeoutMs: 250,
      loginToken: 'token-123',
      cookies: {
        mode: 'manual',
      },
      csrf: {},
      rateLimit: false,
    });

    const response = await client.fetchImpl('https://example.test/api/files', {
      method: 'POST',
      body: JSON.stringify({ id: 2 }),
    });

    expect(response.status).toBe(200);
    expect(whoamiCalls).toBe(2);
    expect(csrfCalls).toBe(2);
    expect(fileAttempts).toHaveLength(2);
    expect(fileAttempts[0]?.cookie).toContain('ct_session=initial');
    expect(fileAttempts[0]?.csrfToken).toBe('csrf-token-1');
    expect(fileAttempts[0]?.retryAttempt).toBeUndefined();
    expect(fileAttempts[0]?.authenticatedHeader).toBe('1');
    expect(fileAttempts[1]?.cookie).toContain('ct_session=renewed');
    expect(fileAttempts[1]?.csrfToken).toBe('csrf-token-2');
    expect(fileAttempts[1]?.retryAttempt).toBe(1);
    expect(fileAttempts[1]?.authenticatedHeader).toBe('1');
  });

  test('retries once on 429 while preserving auth/cookie/csrf headers', async () => {
    let whoamiCalls = 0;
    let csrfCalls = 0;
    const fileAttempts: Array<{
      cookie: string | null;
      csrfToken: string | null;
      authenticatedHeader: string | null;
    }> = [];

    const fetchMock: FetchLike = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.startsWith('https://example.test/api/whoami')) {
        whoamiCalls += 1;
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': 'ct_session=initial; Path=/; HttpOnly',
          },
        });
      }

      if (url === 'https://example.test/api/csrftoken') {
        csrfCalls += 1;
        return new Response('csrf-token-1', { status: 200 });
      }

      if (url === 'https://example.test/api/files') {
        const headers = new Headers(init?.headers);
        fileAttempts.push({
          cookie: headers.get('cookie'),
          csrfToken: headers.get('csrf-token'),
          authenticatedHeader: headers.get('x-onlyauthenticated'),
        });

        if (fileAttempts.length === 1) {
          return new Response(
            JSON.stringify({ message: 'Too many requests' }),
            {
              status: 429,
              headers: {
                'content-type': 'application/json',
                'retry-after': '0',
              },
            },
          );
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        });
      }

      throw new Error(`Unexpected request URL: ${url}`);
    };

    const client = new ChurchToolsClient({
      baseUrl: 'https://example.test',
      fetch: fetchMock,
      timeoutMs: 250,
      loginToken: 'token-123',
      cookies: {
        mode: 'manual',
      },
      csrf: {},
      rateLimit: {
        maxRetries: 1,
      },
    });

    const response = await client.fetchImpl('https://example.test/api/files', {
      method: 'POST',
      body: JSON.stringify({ id: 3 }),
    });

    expect(response.status).toBe(200);
    expect(whoamiCalls).toBe(1);
    expect(csrfCalls).toBe(1);
    expect(fileAttempts).toHaveLength(2);
    expect(fileAttempts[0]?.cookie).toContain('ct_session=initial');
    expect(fileAttempts[0]?.csrfToken).toBe('csrf-token-1');
    expect(fileAttempts[0]?.authenticatedHeader).toBe('1');
    expect(fileAttempts[1]?.cookie).toContain('ct_session=initial');
    expect(fileAttempts[1]?.csrfToken).toBe('csrf-token-1');
    expect(fileAttempts[1]?.authenticatedHeader).toBe('1');
  });
});

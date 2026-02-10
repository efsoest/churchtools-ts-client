import { describe, expect, test } from 'bun:test';

import { createSessionAuthMiddleware } from '../../src/core/auth';
import { createTransportFetch, type FetchLike } from '../../src/core/transport';

const JSON_HEADERS = {
  'content-type': 'application/json',
};

describe('core auth middleware', () => {
  test('performs initial whoami bridge and sets X-OnlyAuthenticated header', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];

    const fetchMock: FetchLike = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });

      if (url.startsWith('https://example.test/api/whoami')) {
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: JSON_HEADERS,
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    };

    const authMiddleware = createSessionAuthMiddleware({
      baseUrl: 'https://example.test',
      fetchApi: fetchMock,
      timeoutMs: 200,
      loginToken: 'token-123',
      loginPersonId: 42,
      forceSession: true,
    });
    expect(authMiddleware).toBeDefined();

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 200,
      middleware: [authMiddleware!],
    });

    await transportFetch('https://example.test/api/persons', { method: 'GET' });

    expect(calls.length).toBe(2);
    expect(calls[0]?.url).toContain('/api/whoami?');
    expect(calls[0]?.url).toContain('login_token=token-123');
    expect(calls[0]?.url).toContain('user_id=42');
    expect(calls[0]?.url).toContain('with_session=true');

    const requestHeaders = new Headers(calls[1]?.init?.headers);
    expect(requestHeaders.get('x-onlyauthenticated')).toBe('1');
  });

  test('recovers from 401 by refreshing session and retrying once', async () => {
    let requestAttempts = 0;
    const calls: string[] = [];

    const fetchMock: FetchLike = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);

      if (url.startsWith('https://example.test/api/whoami')) {
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: JSON_HEADERS,
        });
      }

      requestAttempts += 1;
      if (requestAttempts === 1) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: JSON_HEADERS,
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    };

    const authMiddleware = createSessionAuthMiddleware({
      baseUrl: 'https://example.test',
      fetchApi: fetchMock,
      timeoutMs: 200,
      loginToken: 'token-123',
    });

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 200,
      middleware: [authMiddleware!],
    });

    const response = await transportFetch('https://example.test/api/persons', {
      method: 'GET',
    });

    expect(response.status).toBe(200);
    expect(requestAttempts).toBe(2);
    expect(calls.filter((url) => url.includes('/api/whoami')).length).toBe(2);
  });

  test('treats 200 + Session expired! as unauthorized and recovers via whoami', async () => {
    let requestAttempts = 0;
    const calls: string[] = [];

    const fetchMock: FetchLike = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);

      if (url.startsWith('https://example.test/api/whoami')) {
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: JSON_HEADERS,
        });
      }

      requestAttempts += 1;
      if (requestAttempts === 1) {
        return new Response(JSON.stringify({ message: 'Session expired!' }), {
          status: 200,
          headers: JSON_HEADERS,
        });
      }

      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    };

    const authMiddleware = createSessionAuthMiddleware({
      baseUrl: 'https://example.test',
      fetchApi: fetchMock,
      timeoutMs: 200,
      loginToken: 'token-123',
    });

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 200,
      middleware: [authMiddleware!],
    });

    const response = await transportFetch('https://example.test/api/persons', {
      method: 'GET',
    });
    const payload = (await response.json()) as { data?: { ok?: boolean } };

    expect(payload.data?.ok).toBe(true);
    expect(requestAttempts).toBe(2);
    expect(calls.filter((url) => url.includes('/api/whoami')).length).toBe(2);
  });
});

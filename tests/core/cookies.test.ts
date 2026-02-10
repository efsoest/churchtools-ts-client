import { describe, expect, test } from 'bun:test';

import {
  createCookieSessionMiddleware,
  InMemoryCookieStore,
} from '../../src/core/cookies';
import { createSessionAuthMiddleware } from '../../src/core/auth';
import { createTransportFetch, type FetchLike } from '../../src/core/transport';

describe('core cookie middleware', () => {
  test('reuses cookies from set-cookie on following requests', async () => {
    let requestCount = 0;

    const fetchMock: FetchLike = async (_input, init) => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response('ok', {
          status: 200,
          headers: {
            'set-cookie': 'ct_session=abc123; Path=/; HttpOnly',
          },
        });
      }

      const headers = new Headers(init?.headers);
      expect(headers.get('cookie')).toContain('ct_session=abc123');
      return new Response('ok', { status: 200 });
    };

    const middleware = createCookieSessionMiddleware({
      baseUrl: 'https://example.test',
      options: {
        mode: 'manual',
        store: new InMemoryCookieStore(),
      },
    });

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 300,
      middleware: [middleware!],
    });

    await transportFetch('https://example.test/api/whoami', { method: 'GET' });
    await transportFetch('https://example.test/api/persons', { method: 'GET' });

    expect(requestCount).toBe(2);
  });

  test('removes expired cookies from max-age=0 updates', async () => {
    const store = new InMemoryCookieStore();
    await store.setCookies('https://example.test/api/whoami', [
      'ct_session=abc123; Path=/; HttpOnly',
    ]);
    expect(
      await store.getCookieHeader('https://example.test/api/persons'),
    ).toContain('ct_session=abc123');

    await store.setCookies('https://example.test/api/logout', [
      'ct_session=; Path=/; Max-Age=0',
    ]);

    const cookieHeader = await store.getCookieHeader(
      'https://example.test/api/persons',
    );
    expect(cookieHeader).toBeUndefined();
  });

  test('does not override explicit cookie header', async () => {
    const store = new InMemoryCookieStore();
    await store.setCookies('https://example.test/api/whoami', [
      'ct_session=stored-cookie; Path=/; HttpOnly',
    ]);

    const fetchMock: FetchLike = async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('cookie')).toBe('explicit=1');
      return new Response('ok', { status: 200 });
    };

    const middleware = createCookieSessionMiddleware({
      baseUrl: 'https://example.test',
      options: {
        mode: 'manual',
        store,
      },
    });

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 300,
      middleware: [middleware!],
    });

    await transportFetch('https://example.test/api/persons', {
      method: 'GET',
      headers: {
        Cookie: 'explicit=1',
      },
    });
  });

  test('works with auth whoami bridge and replays session cookie', async () => {
    let whoamiCalls = 0;

    const fetchMock: FetchLike = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://example.test/api/whoami')) {
        whoamiCalls += 1;
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': 'ct_session=from-whoami; Path=/; HttpOnly',
          },
        });
      }

      const headers = new Headers(init?.headers);
      expect(headers.get('cookie')).toContain('ct_session=from-whoami');
      expect(headers.get('x-onlyauthenticated')).toBe('1');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    };

    const cookieMiddleware = createCookieSessionMiddleware({
      baseUrl: 'https://example.test',
      options: {
        mode: 'manual',
        store: new InMemoryCookieStore(),
      },
    });
    const authMiddleware = createSessionAuthMiddleware({
      baseUrl: 'https://example.test',
      timeoutMs: 300,
      loginToken: 'token-123',
    });

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 300,
      middleware: [authMiddleware!, cookieMiddleware!],
    });

    await transportFetch('https://example.test/api/persons', { method: 'GET' });
    expect(whoamiCalls).toBe(1);
  });
});

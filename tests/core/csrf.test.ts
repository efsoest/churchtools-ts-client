import { describe, expect, test } from 'bun:test';

import { createCsrfMiddleware } from '../../src/core/csrf';
import { createTransportFetch, type FetchLike } from '../../src/core/transport';

describe('core csrf middleware', () => {
  test('loads csrf token and injects it into mutating requests', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];

    const fetchMock: FetchLike = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });

      if (url === 'https://example.test/api/csrftoken') {
        return new Response('csrf-token-123', { status: 200 });
      }

      const headers = new Headers(init?.headers);
      expect(headers.get('CSRF-Token')).toBe('csrf-token-123');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const csrfMiddleware = createCsrfMiddleware({
      baseUrl: 'https://example.test',
      timeoutMs: 200,
    });

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 200,
      middleware: [csrfMiddleware],
    });

    await transportFetch('https://example.test/api/files', {
      method: 'POST',
      body: JSON.stringify({ id: 1 }),
    });

    expect(calls[0]?.url).toBe('https://example.test/api/csrftoken');
    expect(calls[1]?.url).toBe('https://example.test/api/files');
  });

  test('does not load csrf token for non-mutating requests', async () => {
    const calls: string[] = [];
    const fetchMock: FetchLike = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const csrfMiddleware = createCsrfMiddleware({
      baseUrl: 'https://example.test',
      timeoutMs: 200,
    });

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 200,
      middleware: [csrfMiddleware],
    });

    await transportFetch('https://example.test/api/persons', {
      method: 'GET',
    });

    expect(calls).toEqual(['https://example.test/api/persons']);
  });

  test('refreshes csrf token after session-retry attempt', async () => {
    const issuedTokens = ['csrf-token-1', 'csrf-token-2'];
    let tokenIndex = 0;

    const fetchMock: FetchLike = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://example.test/api/csrftoken') {
        const token =
          issuedTokens[tokenIndex] ?? issuedTokens[issuedTokens.length - 1];
        tokenIndex += 1;
        return new Response(token, { status: 200 });
      }

      const headers = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          csrf: headers.get('CSRF-Token'),
          retryAttempt: (
            init as RequestInit & { __ctSessionRetryAttempt?: number }
          ).__ctSessionRetryAttempt,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    };

    const csrfMiddleware = createCsrfMiddleware({
      baseUrl: 'https://example.test',
      timeoutMs: 200,
    });
    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 200,
      middleware: [csrfMiddleware],
    });

    const firstResponse = await transportFetch(
      'https://example.test/api/files',
      {
        method: 'POST',
        body: JSON.stringify({ first: true }),
      },
    );
    const firstPayload = (await firstResponse.json()) as { csrf?: string };
    expect(firstPayload.csrf).toBe('csrf-token-1');

    const retryResponse = await transportFetch(
      'https://example.test/api/files',
      {
        method: 'POST',
        body: JSON.stringify({ second: true }),
        __ctSessionRetryAttempt: 1,
      } as RequestInit,
    );
    const retryPayload = (await retryResponse.json()) as { csrf?: string };
    expect(retryPayload.csrf).toBe('csrf-token-2');
  });
});

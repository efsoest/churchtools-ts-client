import { describe, expect, test } from 'bun:test';

import {
  ChurchToolsHttpError,
  ChurchToolsTimeoutError,
} from '../../src/core/errors';
import { createTransportFetch, type FetchLike } from '../../src/core/transport';

describe('core transport', () => {
  test('runs middleware in order and allows pre-request mutations', async () => {
    const callOrder: string[] = [];

    const fetchMock: FetchLike = async (_input, init) => {
      callOrder.push('fetch');
      const headers = new Headers(init?.headers);
      expect(headers.get('x-pre')).toBe('enabled');

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    };

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 250,
      middleware: [
        {
          pre: async (context) => {
            callOrder.push('pre');
            const headers = new Headers(context.request.init.headers);
            headers.set('x-pre', 'enabled');
            return {
              ...context.request,
              init: {
                ...context.request.init,
                headers,
              },
            };
          },
          post: async () => {
            callOrder.push('post');
          },
        },
      ],
    });

    const response = await transportFetch('https://example.test/resource', {
      method: 'GET',
    });

    expect(response.status).toBe(200);
    expect(callOrder).toEqual(['pre', 'fetch', 'post']);
  });

  test('throws ChurchToolsHttpError for non-2xx responses', async () => {
    const fetchMock: FetchLike = async () =>
      new Response('failure', {
        status: 500,
      });

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 250,
    });

    try {
      await transportFetch('https://example.test/failure');
      throw new Error('expected request to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ChurchToolsHttpError);
      const httpError = error as ChurchToolsHttpError;
      expect(httpError.status).toBe(500);
      expect(httpError.url).toBe('https://example.test/failure');
    }
  });

  test('throws ChurchToolsTimeoutError when timeout is reached', async () => {
    const fetchMock: FetchLike = async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          return;
        }
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 5,
    });

    try {
      await transportFetch('https://example.test/timeout');
      throw new Error('expected request to timeout');
    } catch (error) {
      expect(error).toBeInstanceOf(ChurchToolsTimeoutError);
      const timeoutError = error as ChurchToolsTimeoutError;
      expect(timeoutError.timeoutMs).toBe(5);
    }
  });
});

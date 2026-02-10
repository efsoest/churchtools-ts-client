import { describe, expect, test } from 'bun:test';

import { ChurchToolsHttpError } from '../../src/core/errors';
import { createRateLimitMiddleware } from '../../src/core/rate-limit';
import { createTransportFetch, type FetchLike } from '../../src/core/transport';

const JSON_HEADERS = {
  'content-type': 'application/json',
};

describe('core rate-limit middleware', () => {
  test('retries once after 429 and returns successful response', async () => {
    let attempts = 0;

    const fetchMock: FetchLike = async () => {
      attempts += 1;

      if (attempts === 1) {
        return new Response(JSON.stringify({ message: 'Too many requests' }), {
          status: 429,
          headers: JSON_HEADERS,
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    };

    const rateLimitMiddleware = createRateLimitMiddleware({
      maxRetries: 1,
      baseDelayMs: 1,
      backoffFactor: 1,
      jitterRatio: 0,
    });
    expect(rateLimitMiddleware).toBeDefined();

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 500,
      middleware: [rateLimitMiddleware!],
    });

    const response = await transportFetch('https://example.test/api/persons', {
      method: 'GET',
    });

    expect(response.status).toBe(200);
    expect(attempts).toBe(2);
  });

  test('throws when max retries are exhausted', async () => {
    let attempts = 0;
    const fetchMock: FetchLike = async () => {
      attempts += 1;
      return new Response(JSON.stringify({ message: 'Too many requests' }), {
        status: 429,
        headers: JSON_HEADERS,
      });
    };

    const rateLimitMiddleware = createRateLimitMiddleware({
      maxRetries: 1,
      baseDelayMs: 1,
      backoffFactor: 1,
      jitterRatio: 0,
    });

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 500,
      middleware: [rateLimitMiddleware!],
    });

    try {
      await transportFetch('https://example.test/api/persons', {
        method: 'GET',
      });
      throw new Error('expected request to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ChurchToolsHttpError);
      const httpError = error as ChurchToolsHttpError;
      expect(httpError.status).toBe(429);
      expect(attempts).toBe(2);
    }
  });

  test('does not retry stream-backed request bodies', async () => {
    let attempts = 0;
    const fetchMock: FetchLike = async () => {
      attempts += 1;
      return new Response(JSON.stringify({ message: 'Too many requests' }), {
        status: 429,
        headers: JSON_HEADERS,
      });
    };

    const rateLimitMiddleware = createRateLimitMiddleware({
      maxRetries: 2,
      baseDelayMs: 1,
      backoffFactor: 1,
      jitterRatio: 0,
    });

    const transportFetch = createTransportFetch({
      fetchApi: fetchMock,
      timeoutMs: 500,
      middleware: [rateLimitMiddleware!],
    });

    const streamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('payload'));
        controller.close();
      },
    });

    try {
      await transportFetch('https://example.test/api/persons', {
        method: 'POST',
        body: streamBody,
      });
      throw new Error('expected request to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ChurchToolsHttpError);
      const httpError = error as ChurchToolsHttpError;
      expect(httpError.status).toBe(429);
      expect(attempts).toBe(1);
    }
  });
});

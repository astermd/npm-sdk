import { describe, expect, it, vi } from 'vitest';
import { FetchHttpClient } from '../../src/http/fetch-http-client.js';
import { TransportError } from '../../src/errors/index.js';

describe('FetchHttpClient', () => {
  it('forwards the request to the injected fetch and returns its response', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{"ok":true}', { status: 200 })));
    const client = new FetchHttpClient(10, fetchImpl);
    const request = new Request('https://api.astermd.com/v1/sales/products/list');

    const response = await client.sendRequest(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]![0]).toBe(request);
  });

  it('passes an abort signal derived from the timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}', { status: 200 })));
    const client = new FetchHttpClient(5, fetchImpl);

    await client.sendRequest(new Request('https://api.astermd.com/v1/sales/products/list'));

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('wraps a network failure in a TransportError that keeps the cause', async () => {
    const cause = new TypeError('fetch failed');
    const fetchImpl = vi.fn<typeof fetch>(() => {
      throw cause;
    });
    const client = new FetchHttpClient(10, fetchImpl);

    const failure = client.sendRequest(new Request('https://api.astermd.com/v1/sales/x'));

    await expect(failure).rejects.toBeInstanceOf(TransportError);
    await expect(failure).rejects.toMatchObject({ cause });
  });

  it('reports a timeout as a TransportError naming the deadline', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const fetchImpl = vi.fn<typeof fetch>(() => {
      throw timeout;
    });
    const client = new FetchHttpClient(3, fetchImpl);

    await expect(client.sendRequest(new Request('https://api.astermd.com/v1/sales/x'))).rejects.toThrow(
      /timed out after 3s/,
    );
  });

  it('rejects a non-positive timeout at construction', () => {
    expect(() => new FetchHttpClient(0)).toThrow(TypeError);
  });
});

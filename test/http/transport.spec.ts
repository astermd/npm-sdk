import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  TransportError,
  ValidationError,
} from '../../src/errors/index.js';
import { FileUpload } from '../../src/http/file-upload.js';
import type { HttpClient } from '../../src/http/http-client.js';
import { Transport } from '../../src/http/transport.js';
import { UrlBuilder } from '../../src/http/url-builder.js';
import { MockHttpClient } from '../support/mock-http-client.js';

function makeTransport(
  overrides: {
    token?: string | null;
    onUnauthorized?: () => Promise<boolean>;
  } = {},
): { transport: Transport; http: MockHttpClient } {
  const http = new MockHttpClient();
  const transport = new Transport({
    httpClient: http,
    urlBuilder: new UrlBuilder('api.astermd.com'),
    tokenProvider: () => Promise.resolve(overrides.token === undefined ? 'test-jwt' : overrides.token),
    onUnauthorized: overrides.onUnauthorized ?? (() => Promise.resolve(false)),
  });

  return { transport, http };
}

describe('Transport request building', () => {
  it('builds the URL, method, and default headers', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(200, { success: true, message: 'ok', data: {} });

    await transport.send({ service: 'sales', method: 'GET', path: '/products/list' });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/products/list');
    expect(request.method).toBe('GET');
    expect(request.headers.accept).toBe('application/json');
    expect(request.headers.authorization).toBe('Bearer test-jwt');
  });

  it('omits the Authorization header when the token provider returns null', async () => {
    const { transport, http } = makeTransport({ token: null });
    http.enqueueJson(200, { data: {} });

    await transport.send({
      service: 'auth',
      method: 'POST',
      path: '/api-credentials/token',
      body: {},
    });

    expect(http.lastRequest().headers.authorization).toBeUndefined();
  });

  it('serialises a JSON body and sets the content type', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(201, { data: {} });

    await transport.send({
      service: 'sales',
      method: 'POST',
      path: '/carts/create',
      body: { session: 's-1', items: [{ product_id: 'p-1', quantity: 2 }] },
    });

    const request = http.lastRequest();
    expect(request.headers['content-type']).toBe('application/json');
    expect(JSON.parse(request.body)).toEqual({
      session: 's-1',
      items: [{ product_id: 'p-1', quantity: 2 }],
    });
  });

  it('sends an empty object body as {}, which every AsterMD endpoint requires', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(200, { data: {} });

    await transport.send({ service: 'sales', method: 'POST', path: '/sessions/create', body: {} });

    expect(http.lastRequest().body).toBe('{}');
  });

  it('sends no body and no content type when body is omitted', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(200, { data: {} });

    await transport.send({
      service: 'sales',
      method: 'DELETE',
      path: '/sessions/delete/{id}',
      pathParams: { id: 's-1' },
    });

    const request = http.lastRequest();
    expect(request.body).toBe('');
    expect(request.headers['content-type']).toBeUndefined();
  });

  it('applies extra headers such as the PHI verification token', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(200, { data: {} });

    await transport.send({
      service: 'sales',
      method: 'POST',
      path: '/patients/health-information',
      body: {},
      headers: { 'x-phi-verification-token': 'fake-phi-token' },
    });

    expect(http.lastRequest().headers['x-phi-verification-token']).toBe('fake-phi-token');
  });

  it('encodes a FileUpload as a single multipart part named file', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(200, { data: {} });

    await transport.send({
      service: 'sales',
      method: 'POST',
      path: '/intake-submissions/upload-file/{session_id}',
      pathParams: { session_id: 's-1' },
      file: FileUpload.fromContents(new Uint8Array([1, 2, 3]), 'id-front.jpg'),
    });

    const request = http.lastRequest();
    expect(request.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);

    const part = request.formData!.get('file') as File;
    expect(part.name).toBe('id-front.jpg');
    expect(part.type).toBe('image/jpeg');
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('refuses a request carrying both a JSON body and a file', async () => {
    const { transport } = makeTransport();

    await expect(
      transport.send({
        service: 'sales',
        method: 'POST',
        path: '/x',
        body: {},
        file: FileUpload.fromContents(new Uint8Array([0]), 'f.jpg'),
      }),
    ).rejects.toThrow(TypeError);
  });
});

describe('Transport envelope decoding', () => {
  it('returns a Response carrying every envelope field', async () => {
    const { transport, http } = makeTransport();
    const envelope = {
      success: true,
      message: 'Session created.',
      data: { session: 's-1' },
      meta: { total: 1 },
    };
    http.enqueueJson(201, envelope);

    const response = await transport.send({
      service: 'sales',
      method: 'POST',
      path: '/sessions/create',
      body: {},
    });

    expect(response.statusCode()).toBe(201);
    expect(response.data()).toEqual({ session: 's-1' });
    expect(response.meta()).toEqual({ total: 1 });
    expect(response.message()).toBe('Session created.');
    expect(response.raw()).toBe(JSON.stringify(envelope));
  });

  it('defaults data, meta and message when the envelope omits them', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(200, { success: true });

    const response = await transport.send({ service: 'sales', method: 'GET', path: '/x' });

    expect(response.data()).toEqual({});
    expect(response.meta()).toEqual({});
    expect(response.message()).toBe('');
  });

  it('preserves a list-shaped data payload', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(200, { data: [{ id: 'p-1' }, { id: 'p-2' }] });

    const response = await transport.send({
      service: 'sales',
      method: 'GET',
      path: '/products/list',
    });

    expect(response.data()).toEqual([{ id: 'p-1' }, { id: 'p-2' }]);
  });

  it('tolerates an empty body and non-JSON on a 2xx', async () => {
    const { transport, http } = makeTransport();
    http.enqueue(200, '');
    http.enqueue(200, 'not json at all');

    expect((await transport.send({ service: 'sales', method: 'GET', path: '/a' })).data()).toEqual({});
    expect((await transport.send({ service: 'sales', method: 'GET', path: '/b' })).data()).toEqual({});
  });
});

describe('Transport status mapping', () => {
  it('maps 401 to AuthenticationError when no retry is offered', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(401, { message: 'Unauthenticated.' });

    await expect(transport.send({ service: 'sales', method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it('maps 404 to NotFoundError', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(404, { message: 'Patient not found.' });

    const failure = transport.send({ service: 'sales', method: 'GET', path: '/x' });

    await expect(failure).rejects.toBeInstanceOf(NotFoundError);
    await expect(failure).rejects.toThrow('Patient not found.');
  });

  it('maps 422 to ValidationError and extracts field errors', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(422, {
      message: 'The given data was invalid.',
      errors: { email: ['The email field is required.'], dob: 'Must be a date.' },
    });

    try {
      await transport.send({ service: 'sales', method: 'POST', path: '/x', body: {} });
      throw new Error('expected ValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors()).toEqual({
        email: ['The email field is required.'],
        dob: ['Must be a date.'],
      });
    }
  });

  it('accepts a field whose errors are a JSON object, taking its values like PHP is_array does', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(422, {
      message: 'The given data was invalid.',
      errors: { address: { street: 'Street is required.', city: 'City is required.' } },
    });

    try {
      await transport.send({ service: 'sales', method: 'POST', path: '/x', body: {} });
      throw new Error('expected ValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors()).toEqual({
        address: ['Street is required.', 'City is required.'],
      });
    }
  });

  it('ignores an array-shaped errors payload rather than inventing numeric field names', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(422, { message: 'The given data was invalid.', errors: ['first', 'second'] });

    try {
      await transport.send({ service: 'sales', method: 'POST', path: '/x', body: {} });
      throw new Error('expected ValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors()).toEqual({});
    }
  });

  it('maps 429 to RateLimitError and parses Retry-After', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(429, { message: 'Too many requests.' }, { 'Retry-After': '30' });

    try {
      await transport.send({ service: 'sales', method: 'GET', path: '/x' });
      throw new Error('expected RateLimitError');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).retryAfter()).toBe(30);
    }
  });

  it('reports retryAfter as null when the header is absent or not an integer', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(429, { message: 'slow' });
    http.enqueueJson(429, { message: 'slow' }, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' });

    for (let i = 0; i < 2; i += 1) {
      try {
        await transport.send({ service: 'sales', method: 'GET', path: '/x' });
      } catch (error) {
        expect((error as RateLimitError).retryAfter()).toBeNull();
      }
    }
  });

  it.each([[400], [403], [409], [500], [502], [503]])('maps %i to ApiError', async status => {
    const { transport, http } = makeTransport();
    http.enqueueJson(status, { message: 'nope' });

    try {
      await transport.send({ service: 'sales', method: 'GET', path: '/x' });
      throw new Error('expected ApiError');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode()).toBe(status);
    }
  });

  it('falls back to HTTP {status} when the error envelope has no message', async () => {
    const { transport, http } = makeTransport();
    http.enqueue(500, '');

    await expect(transport.send({ service: 'sales', method: 'GET', path: '/x' })).rejects.toThrow('HTTP 500');
  });

  it('keeps the decoded envelope on the error', async () => {
    const { transport, http } = makeTransport();
    http.enqueueJson(409, { message: 'Conflict.', code: 'ALREADY_EXISTS' });

    try {
      await transport.send({ service: 'sales', method: 'POST', path: '/x', body: {} });
    } catch (error) {
      expect((error as ApiError).envelope()).toEqual({
        message: 'Conflict.',
        code: 'ALREADY_EXISTS',
      });
    }
  });
});

describe('Transport 401 retry protocol', () => {
  it('replays the request once when onUnauthorized returns true', async () => {
    const onUnauthorized = vi.fn(() => Promise.resolve(true));
    const { transport, http } = makeTransport({ onUnauthorized });
    http.enqueueJson(401, { message: 'Unauthenticated.' });
    http.enqueueJson(200, { data: { session: 's-1' } });

    const response = await transport.send({
      service: 'sales',
      method: 'GET',
      path: '/sessions/view',
    });

    expect(response.data()).toEqual({ session: 's-1' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(http.requests).toHaveLength(2);
  });

  it('resends the original body on the replay, not an empty one', async () => {
    const { transport, http } = makeTransport({ onUnauthorized: () => Promise.resolve(true) });
    http.enqueueJson(401, { message: 'Unauthenticated.' });
    http.enqueueJson(200, { data: {} });

    await transport.send({
      service: 'sales',
      method: 'POST',
      path: '/opportunities/create',
      body: { first_name: 'Jane', email: 'jane@example.test' },
    });

    expect(http.requests).toHaveLength(2);
    expect(JSON.parse(http.requests[0]!.body)).toEqual({
      first_name: 'Jane',
      email: 'jane@example.test',
    });
    expect(JSON.parse(http.requests[1]!.body)).toEqual({
      first_name: 'Jane',
      email: 'jane@example.test',
    });
  });

  it('resends the file on the replay of a multipart request', async () => {
    const { transport, http } = makeTransport({ onUnauthorized: () => Promise.resolve(true) });
    http.enqueueJson(401, { message: 'Unauthenticated.' });
    http.enqueueJson(200, { data: {} });

    await transport.send({
      service: 'sales',
      method: 'POST',
      path: '/intake-submissions/upload-file/{session_id}',
      pathParams: { session_id: 's-1' },
      file: FileUpload.fromContents(new Uint8Array([7, 7, 7]), 'scan.png'),
    });

    const replayed = http.requests[1]!.formData!.get('file') as File;
    expect(new Uint8Array(await replayed.arrayBuffer())).toEqual(new Uint8Array([7, 7, 7]));
  });

  it('picks up the refreshed token on the replay', async () => {
    const http = new MockHttpClient();
    const tokens = ['stale-jwt', 'fresh-jwt'];
    const transport = new Transport({
      httpClient: http,
      urlBuilder: new UrlBuilder('api.astermd.com'),
      tokenProvider: () => Promise.resolve(tokens.shift() ?? 'fresh-jwt'),
      onUnauthorized: () => Promise.resolve(true),
    });
    http.enqueueJson(401, { message: 'Unauthenticated.' });
    http.enqueueJson(200, { data: {} });

    await transport.send({ service: 'sales', method: 'GET', path: '/x' });

    expect(http.requests[0]!.headers.authorization).toBe('Bearer stale-jwt');
    expect(http.requests[1]!.headers.authorization).toBe('Bearer fresh-jwt');
  });

  it('raises AuthenticationError when the replay also returns 401, without retrying again', async () => {
    const onUnauthorized = vi.fn(() => Promise.resolve(true));
    const { transport, http } = makeTransport({ onUnauthorized });
    http.enqueueJson(401, { message: 'Unauthenticated.' });
    http.enqueueJson(401, { message: 'Unauthenticated.' });

    await expect(transport.send({ service: 'sales', method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(http.requests).toHaveLength(2);
  });

  it('does not replay when onUnauthorized returns false', async () => {
    const { transport, http } = makeTransport({ onUnauthorized: () => Promise.resolve(false) });
    http.enqueueJson(401, { message: 'Unauthenticated.' });

    await expect(transport.send({ service: 'sales', method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    expect(http.requests).toHaveLength(1);
  });
});

describe('Transport error contract', () => {
  it('wraps a plain Error thrown by an injected HttpClient into TransportError', async () => {
    const original = new Error('socket hang up');
    const httpClient: HttpClient = {
      sendRequest: () => Promise.reject(original),
    };
    const transport = new Transport({
      httpClient,
      urlBuilder: new UrlBuilder('api.astermd.com'),
      tokenProvider: () => Promise.resolve('test-jwt'),
      onUnauthorized: () => Promise.resolve(false),
    });

    const failure = transport.send({ service: 'sales', method: 'GET', path: '/x' });

    await expect(failure).rejects.toBeInstanceOf(TransportError);
    await expect(failure).rejects.toMatchObject({ cause: original });
  });

  it('lets an AsterMDError thrown by an injected HttpClient pass through unwrapped', async () => {
    const original = new AuthenticationError('nope', 401, {});
    const httpClient: HttpClient = {
      sendRequest: () => Promise.reject(original),
    };
    const transport = new Transport({
      httpClient,
      urlBuilder: new UrlBuilder('api.astermd.com'),
      tokenProvider: () => Promise.resolve('test-jwt'),
      onUnauthorized: () => Promise.resolve(false),
    });

    const failure = transport.send({ service: 'sales', method: 'GET', path: '/x' });

    await expect(failure).rejects.toBe(original);
  });

  it('wraps a response body read failure into TransportError', async () => {
    const httpClient: HttpClient = {
      sendRequest: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('terminated'));
              },
            }),
            { status: 200 },
          ),
        ),
    };
    const transport = new Transport({
      httpClient,
      urlBuilder: new UrlBuilder('api.astermd.com'),
      tokenProvider: () => Promise.resolve('test-jwt'),
      onUnauthorized: () => Promise.resolve(false),
    });

    await expect(transport.send({ service: 'sales', method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      TransportError,
    );
  });
});

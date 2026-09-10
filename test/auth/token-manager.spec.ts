import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryTokenStore } from '../../src/auth/in-memory-token-store.js';
import { Token } from '../../src/auth/token.js';
import { TokenManager } from '../../src/auth/token-manager.js';
import { Config } from '../../src/config.js';
import { AuthenticationError } from '../../src/errors/index.js';
import { UrlBuilder } from '../../src/http/url-builder.js';
import { MockHttpClient } from '../support/mock-http-client.js';

const config = new Config({ clientId: 'test-client-id', clientSecret: 'test-client-secret' });

function makeManager(store = new InMemoryTokenStore()): {
  manager: TokenManager;
  http: MockHttpClient;
  store: InMemoryTokenStore;
} {
  const http = new MockHttpClient();
  const manager = new TokenManager({
    config,
    httpClient: http,
    urlBuilder: new UrlBuilder('api.astermd.com'),
    store,
  });

  return { manager, http, store };
}

function tokenEnvelope(value: string, expiresAt = '2099-01-01T00:00:00.000Z'): unknown {
  return { success: true, data: { access_token: value, access_token_expiry: expiresAt } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TokenManager acquisition', () => {
  it('exchanges credentials on the first call and returns the JWT', async () => {
    const { manager, http } = makeManager();
    http.enqueueJson(200, tokenEnvelope('fresh-jwt'));

    expect(await manager.bearerToken()).toBe('fresh-jwt');
  });

  it('posts the credentials to the auth service unauthenticated', async () => {
    const { manager, http } = makeManager();
    http.enqueueJson(200, tokenEnvelope('fresh-jwt'));

    await manager.bearerToken();

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/auth/api-credentials/token');
    expect(request.method).toBe('POST');
    expect(request.headers.authorization).toBeUndefined();
    expect(JSON.parse(request.body)).toEqual({
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
    });
  });

  it('stores the acquired token', async () => {
    const { manager, http, store } = makeManager();
    http.enqueueJson(200, tokenEnvelope('fresh-jwt', '2099-01-01T00:00:00.000Z'));

    await manager.bearerToken();
    const stored = await store.get();

    expect(stored!.value()).toBe('fresh-jwt');
    expect(stored!.expiresAt().toISOString()).toBe('2099-01-01T00:00:00.000Z');
  });

  it('reuses a cached, unexpired token without any HTTP call', async () => {
    const store = new InMemoryTokenStore();
    await store.put(new Token('cached-jwt', new Date('2099-01-01T00:00:00.000Z')));
    const { manager, http } = makeManager(store);

    expect(await manager.bearerToken()).toBe('cached-jwt');
    expect(http.requests).toHaveLength(0);
  });

  it('replaces a cached token that is inside the 30-second pre-buffer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T11:59:45.000Z'));

    const store = new InMemoryTokenStore();
    await store.put(new Token('stale-jwt', new Date('2026-09-08T12:00:00.000Z')));
    const { manager, http } = makeManager(store);
    http.enqueueJson(200, tokenEnvelope('fresh-jwt'));

    expect(await manager.bearerToken()).toBe('fresh-jwt');
    expect(http.requests).toHaveLength(1);
  });

  it('honours a custom expiry pre-buffer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T11:50:00.000Z'));

    const store = new InMemoryTokenStore();
    await store.put(new Token('stale-jwt', new Date('2026-09-08T12:00:00.000Z')));
    const http = new MockHttpClient();
    const manager = new TokenManager({
      config,
      httpClient: http,
      urlBuilder: new UrlBuilder('api.astermd.com'),
      store,
      expiryPreBufferSeconds: 900,
    });
    http.enqueueJson(200, tokenEnvelope('fresh-jwt'));

    expect(await manager.bearerToken()).toBe('fresh-jwt');
  });

  it.each([
    ['no data at all', { success: true }],
    ['a missing access_token', { data: { access_token_expiry: '2099-01-01T00:00:00.000Z' } }],
    ['a missing access_token_expiry', { data: { access_token: 'jwt' } }],
    ['a non-string access_token', { data: { access_token: 1, access_token_expiry: '2099-01-01T00:00:00.000Z' } }],
  ])('raises AuthenticationError on a token response with %s', async (_label, envelope) => {
    const { manager, http } = makeManager();
    http.enqueueJson(200, envelope);

    await expect(manager.bearerToken()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('lets an AuthenticationError from the credential exchange itself surface', async () => {
    const { manager, http } = makeManager();
    http.enqueueJson(401, { message: 'Invalid client credentials.' });

    await expect(manager.bearerToken()).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe('TokenManager concurrency', () => {
  it('performs one credential exchange for many concurrent cold calls', async () => {
    const { manager, http } = makeManager();
    http.enqueueJson(200, tokenEnvelope('fresh-jwt'));

    const tokens = await Promise.all([
      manager.bearerToken(),
      manager.bearerToken(),
      manager.bearerToken(),
      manager.bearerToken(),
      manager.bearerToken(),
    ]);

    expect(tokens).toEqual(Array<string>(5).fill('fresh-jwt'));
    expect(http.requests).toHaveLength(1);
  });

  it('allows a later acquisition after a failed one, rather than caching the rejection', async () => {
    const { manager, http } = makeManager();
    http.enqueueJson(500, { message: 'Server error.' });
    http.enqueueJson(200, tokenEnvelope('fresh-jwt'));

    await expect(manager.bearerToken()).rejects.toThrow();
    expect(await manager.bearerToken()).toBe('fresh-jwt');
    expect(http.requests).toHaveLength(2);
  });
});

describe('TokenManager refresh', () => {
  it('clears the store, acquires a fresh token and reports true', async () => {
    const store = new InMemoryTokenStore();
    await store.put(new Token('stale-jwt', new Date('2099-01-01T00:00:00.000Z')));
    const { manager, http } = makeManager(store);
    http.enqueueJson(200, tokenEnvelope('fresh-jwt'));

    expect(await manager.refresh()).toBe(true);
    expect((await store.get())!.value()).toBe('fresh-jwt');
  });

  it('refreshes even when the cached token has not expired', async () => {
    const store = new InMemoryTokenStore();
    await store.put(new Token('cached-jwt', new Date('2099-01-01T00:00:00.000Z')));
    const { manager, http } = makeManager(store);
    http.enqueueJson(200, tokenEnvelope('fresh-jwt'));

    await manager.refresh();

    expect(await manager.bearerToken()).toBe('fresh-jwt');
    expect(http.requests).toHaveLength(1);
  });

  it('propagates a failure from the refresh exchange', async () => {
    const { manager, http } = makeManager();
    http.enqueueJson(401, { message: 'Invalid client credentials.' });

    await expect(manager.refresh()).rejects.toBeInstanceOf(AuthenticationError);
  });
});

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AsterMDClient } from '../src/astermd-client.js';
import { InMemoryTokenStore } from '../src/auth/in-memory-token-store.js';
import { Config } from '../src/config.js';
import { Carts } from '../src/resource/carts.js';
import { Sessions } from '../src/resource/sessions.js';
import { Verification } from '../src/resource/verification.js';
import { MockHttpClient } from './support/mock-http-client.js';
import { OK_ENVELOPE, makeClient } from './support/harness.js';

const credentials = { clientId: 'test-client-id', clientSecret: 'test-client-secret' };

describe('AsterMDClient construction', () => {
  it('exposes an immutable Config built from its options', () => {
    const client = new AsterMDClient({ ...credentials, httpClient: new MockHttpClient() });

    expect(client.config()).toBeInstanceOf(Config);
    expect(client.config().baseHost()).toBe('api.astermd.com');
    expect(client.config().timeoutSeconds()).toBe(10);
  });

  it('honours a custom host and timeout', () => {
    const client = new AsterMDClient({
      ...credentials,
      baseHost: 'api.example.test',
      timeoutSeconds: 30,
      httpClient: new MockHttpClient(),
    });

    expect(client.config().baseHost()).toBe('api.example.test');
    expect(client.config().timeoutSeconds()).toBe(30);
  });

  it('rejects empty credentials at construction', () => {
    expect(() => new AsterMDClient({ clientId: '', clientSecret: 's' })).toThrow(TypeError);
  });

  it('rejects a full URL as the host', () => {
    expect(() => new AsterMDClient({ ...credentials, baseHost: 'https://api.astermd.com' })).toThrow(
      /must be a bare host/,
    );
  });

  it('requires a debug destination when debug is on', () => {
    expect(() => new AsterMDClient({ ...credentials, debug: true })).toThrow(TypeError);
    expect(() => new AsterMDClient({ ...credentials, debug: true })).toThrow(
      /debug mode requires debugFile or debugSink/,
    );
  });

  it('delegates assetUrl to the config', () => {
    const client = new AsterMDClient({ ...credentials, httpClient: new MockHttpClient() });

    expect(client.assetUrl('org/tile.png')).toBe('https://cdn.astermd.com/org/tile.png');
  });
});

describe('AsterMDClient resource accessors', () => {
  it('exposes all seventeen resources', () => {
    const { client } = makeClient();

    const accessors = [
      'sessions',
      'intakeSubmissions',
      'carts',
      'checkoutEvents',
      'teleforms',
      'patients',
      'opportunities',
      'treatments',
      'doctorsNetworks',
      'channels',
      'products',
      'categories',
      'labTests',
      'medications',
      'shippings',
      'verification',
      'geo',
    ] as const;

    expect(accessors).toHaveLength(17);

    for (const accessor of accessors) {
      expect(typeof client[accessor]).toBe('function');
      expect(client[accessor]()).toBeDefined();
    }
  });

  it('returns the right class from each accessor', () => {
    const { client } = makeClient();

    expect(client.sessions()).toBeInstanceOf(Sessions);
    expect(client.carts()).toBeInstanceOf(Carts);
    expect(client.verification()).toBeInstanceOf(Verification);
  });

  it('memoizes each resource', () => {
    const { client } = makeClient();

    expect(client.sessions()).toBe(client.sessions());
    expect(client.patients()).toBe(client.patients());
  });
});

describe('AsterMDClient end-to-end wiring', () => {
  it('acquires a token, then makes the API call with it', async () => {
    const { client, http } = makeClient();
    http.enqueueJson(201, { success: true, data: { session: 's-1' } });

    const response = await client.sessions().create();

    expect(http.requests).toHaveLength(2);
    expect(http.requests[0]!.url).toBe('https://api.astermd.com/v1/auth/api-credentials/token');
    expect(http.requests[1]!.url).toBe('https://api.astermd.com/v1/sales/sessions/create');
    expect(http.requests[1]!.headers.authorization).toBe('Bearer test-jwt');
    expect(response.data()).toEqual({ session: 's-1' });
  });

  it('reuses the token across calls', async () => {
    const { client, http } = makeClient();
    http.enqueueJson(200, OK_ENVELOPE);
    http.enqueueJson(200, OK_ENVELOPE);

    await client.products().list();
    await client.categories().list();

    expect(http.requests).toHaveLength(3);
  });

  it('refreshes the token and replays the call on a 401', async () => {
    const { client, http } = makeClient();
    http.enqueueJson(401, { message: 'Unauthenticated.' });
    http.enqueueJson(200, {
      success: true,
      data: { access_token: 'fresh-jwt', access_token_expiry: '2099-01-01T00:00:00.000Z' },
    });
    http.enqueueJson(200, { success: true, data: { id: 'p-1' } });

    const response = await client.products().view('p-1');

    expect(response.data()).toEqual({ id: 'p-1' });
    expect(http.requests).toHaveLength(4);
    expect(http.requests[3]!.headers.authorization).toBe('Bearer fresh-jwt');
  });

  it('uses an injected token store', async () => {
    const store = new InMemoryTokenStore();
    const { client, http } = makeClient({ tokenStore: store });
    http.enqueueJson(200, OK_ENVELOPE);

    await client.products().list();

    expect((await store.get())!.value()).toBe('test-jwt');
  });
});

describe('AsterMDClient debug logging', () => {
  it('routes entries to a debugSink, including the credential exchange', async () => {
    const entries: string[] = [];
    const { client, http } = makeClient({
      debug: true,
      debugSink: entry => {
        entries.push(entry);
      },
    });
    http.enqueueJson(200, OK_ENVELOPE);

    await client.products().list();

    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain('/v1/auth/api-credentials/token');
    expect(entries[1]).toContain('/v1/sales/products/list');
  });

  it('redacts the client secret and the bearer token by default', async () => {
    const entries: string[] = [];
    const { client, http } = makeClient({
      debug: true,
      debugSink: entry => {
        entries.push(entry);
      },
    });
    http.enqueueJson(200, OK_ENVELOPE);

    await client.products().list();

    const joined = entries.join('\n');
    expect(joined).not.toContain('test-client-secret');
    expect(joined).not.toContain('Bearer test-jwt');
    expect(joined).toContain('[REDACTED]');
  });

  it('logs verbatim when debugRedact is false', async () => {
    const entries: string[] = [];
    const { client, http } = makeClient({
      debug: true,
      debugRedact: false,
      debugSink: entry => {
        entries.push(entry);
      },
    });
    http.enqueueJson(200, OK_ENVELOPE);

    await client.products().list();

    expect(entries.join('\n')).toContain('test-client-secret');
  });

  it('writes to a dated file when given debugFile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'astermd-client-log-'));
    const { client, http } = makeClient({ debug: true, debugFile: join(dir, 'sdk.log') });
    http.enqueueJson(200, OK_ENVELOPE);

    await client.products().list();

    const { readdir } = await import('node:fs/promises');
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^sdk-\d{4}-\d{2}-\d{2}\.log$/);
    expect(await readFile(join(dir, files[0]!), 'utf8')).toContain('/v1/sales/products/list');
  });

  it('prefers debugSink over debugFile when both are given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'astermd-client-log-'));
    const entries: string[] = [];
    const { client, http } = makeClient({
      debug: true,
      debugFile: join(dir, 'sdk.log'),
      debugSink: entry => {
        entries.push(entry);
      },
    });
    http.enqueueJson(200, OK_ENVELOPE);

    await client.products().list();

    const { readdir } = await import('node:fs/promises');
    expect(await readdir(dir)).toHaveLength(0);
    expect(entries).toHaveLength(2);
  });

  it('logs nothing when debug is off', async () => {
    const entries: string[] = [];
    const { client, http } = makeClient({
      debugSink: entry => {
        entries.push(entry);
      },
    });
    http.enqueueJson(200, OK_ENVELOPE);

    await client.products().list();

    expect(entries).toHaveLength(0);
  });
});

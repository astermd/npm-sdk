import { AsterMDClient } from '../../src/astermd-client.js';
import { Transport } from '../../src/http/transport.js';
import { UrlBuilder } from '../../src/http/url-builder.js';
import { MockHttpClient } from './mock-http-client.js';

/** A transport wired to a mock client, for exercising one resource in isolation. */
export interface Harness {
  transport: Transport;
  http: MockHttpClient;
}

/**
 * Builds a transport over a {@link MockHttpClient} with a fixed bearer token, so
 * a resource test never has to stage a credential exchange.
 */
export function makeHarness(token: string | null = 'test-jwt'): Harness {
  const http = new MockHttpClient();
  const transport = new Transport({
    httpClient: http,
    urlBuilder: new UrlBuilder('api.astermd.com'),
    tokenProvider: () => Promise.resolve(token),
    onUnauthorized: () => Promise.resolve(false),
  });

  return { transport, http };
}

/** A minimal success envelope, for tests asserting on the request rather than the response. */
export const OK_ENVELOPE = { success: true, message: 'ok', data: {} };

/** A client wired to a mock, with the credential exchange already queued. */
export interface ClientHarness {
  client: AsterMDClient;
  http: MockHttpClient;
}

/**
 * Builds a client over a {@link MockHttpClient} and queues the token response, so
 * the first API call finds a token waiting and the test only has to queue its own
 * responses after that.
 */
export function makeClient(options: Partial<ConstructorParameters<typeof AsterMDClient>[0]> = {}): ClientHarness {
  const http = new MockHttpClient();
  http.enqueueJson(200, {
    success: true,
    data: { access_token: 'test-jwt', access_token_expiry: '2099-01-01T00:00:00.000Z' },
  });

  const client = new AsterMDClient({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    httpClient: http,
    ...options,
  });

  return { client, http };
}

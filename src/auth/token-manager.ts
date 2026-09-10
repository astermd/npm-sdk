import type { Config } from '../config.js';
import { AuthenticationError } from '../errors/index.js';
import type { HttpClient } from '../http/http-client.js';
import { Transport } from '../http/transport.js';
import type { UrlBuilder } from '../http/url-builder.js';
import { InMemoryTokenStore } from './in-memory-token-store.js';
import { Token } from './token.js';
import type { TokenStore } from './token-store.js';

/** Collaborators {@link TokenManager} needs. */
export interface TokenManagerOptions {
  /** Credentials and connection settings. */
  config: Config;
  /** Client used for the credential exchange. */
  httpClient: HttpClient;
  /** URL builder, shared with the main transport. */
  urlBuilder: UrlBuilder;
  /** Storage for the cached JWT. Defaults to {@link InMemoryTokenStore}. */
  store?: TokenStore;
  /**
   * Seconds before the stated expiry at which the token is treated as expired,
   * guarding against clock skew. Defaults to 30.
   */
  expiryPreBufferSeconds?: number;
}

/**
 * Owns the bearer-token lifecycle: lazy acquisition, caching, expiry, refresh.
 *
 * This is the only place in the SDK that exchanges credentials for a JWT. It
 * dispatches that exchange through its own {@link Transport}, built with a token
 * provider that always returns `null` and an unauthorized handler that always
 * returns `false`. That is not a detail - it is what makes recursion impossible.
 * A manager that used the main transport would ask it for a bearer token, which
 * would ask the manager, which would ask the transport, forever.
 *
 * On each {@link TokenManager.bearerToken} call the store is checked for a token
 * that is present and not within `expiryPreBufferSeconds` of expiry. Otherwise
 * `POST /v1/auth/api-credentials/token` is called and the result stored.
 *
 * Acquisition is de-duplicated: concurrent callers arriving while an exchange is
 * in flight all await that same exchange rather than starting their own. On a
 * long-running Node server the first burst of traffic after startup would
 * otherwise fire one credential exchange per concurrent request.
 *
 * The organisation is encoded in the JWT the server issues, which is why no SDK
 * method accepts an organisation argument.
 */
export class TokenManager {
  readonly #config: Config;
  readonly #store: TokenStore;
  readonly #expiryPreBufferSeconds: number;
  readonly #tokenTransport: Transport;

  #inFlight: Promise<Token> | null = null;

  /**
   * @param options The collaborators and tuning to use.
   */
  constructor(options: TokenManagerOptions) {
    this.#config = options.config;
    this.#store = options.store ?? new InMemoryTokenStore();
    this.#expiryPreBufferSeconds = options.expiryPreBufferSeconds ?? 30;

    // Token acquisition runs through a transport with no token provider and no
    // 401 retry. Recursion here would be a bug, so it is made unrepresentable.
    this.#tokenTransport = new Transport({
      httpClient: options.httpClient,
      urlBuilder: options.urlBuilder,
      tokenProvider: () => Promise.resolve(null),
      onUnauthorized: () => Promise.resolve(false),
    });
  }

  /**
   * Returns a valid bearer token, acquiring one if the cache cannot serve it.
   *
   * A cached, unexpired token is returned with no HTTP call. Otherwise the
   * credential exchange runs and its result is stored before being returned. Two
   * concurrent calls that both miss the cache share a single exchange.
   *
   * @returns The raw JWT, ready for `Authorization: Bearer <value>`.
   * @throws {AuthenticationError} If the credentials are refused, or if the token
   *   response omits `access_token` or `access_token_expiry`.
   * @throws {TransportError} If the exchange never completed.
   */
  async bearerToken(): Promise<string> {
    const cached = await this.#store.get();

    if (cached !== null && !cached.isExpired(this.#expiryPreBufferSeconds)) {
      return cached.value();
    }

    return (await this.#acquire()).value();
  }

  /**
   * Discards the cached token, acquires a fresh one, and reports `true`.
   *
   * Always resolves `true` on success so it can be wired straight to
   * {@link Transport}'s `onUnauthorized` hook, where `true` means "token
   * refreshed, replay the request once". A second 401 on that replay raises
   * {@link AuthenticationError} without calling this again.
   *
   * @returns `true`.
   * @throws {AuthenticationError} If the fresh acquisition fails.
   * @throws {TransportError} If the exchange never completed.
   */
  async refresh(): Promise<boolean> {
    await this.#store.clear();
    await this.#acquire();

    return true;
  }

  /**
   * Runs the credential exchange, sharing one in-flight attempt across callers.
   *
   * The in-flight promise is cleared in a `finally`, so a failed exchange is
   * never cached - the next caller gets a fresh attempt rather than the stored
   * rejection.
   */
  async #acquire(): Promise<Token> {
    this.#inFlight ??= this.#exchange().finally(() => {
      this.#inFlight = null;
    });

    return await this.#inFlight;
  }

  async #exchange(): Promise<Token> {
    const response = await this.#tokenTransport.send({
      service: 'auth',
      method: 'POST',
      path: '/api-credentials/token',
      body: {
        client_id: this.#config.clientId(),
        client_secret: this.#config.clientSecret(),
      },
    });

    const data = response.data();
    const value = data.access_token;
    const expiry = data.access_token_expiry;

    if (typeof value !== 'string' || typeof expiry !== 'string') {
      throw new AuthenticationError(
        'Token response missing access_token / access_token_expiry.',
        response.statusCode(),
        { data },
      );
    }

    const expiresAt = new Date(expiry);

    if (Number.isNaN(expiresAt.getTime())) {
      throw new AuthenticationError(
        `Token response carried an unparseable access_token_expiry: ${expiry}`,
        response.statusCode(),
        { data },
      );
    }

    const token = new Token(value, expiresAt);
    await this.#store.put(token);

    return token;
  }
}

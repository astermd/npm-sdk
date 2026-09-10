/** Base URL of the AsterMD asset CDN, including the trailing slash. */
const ASSET_BASE_URL = 'https://cdn.astermd.com/';

/** Default bare API hostname. */
const DEFAULT_BASE_HOST = 'api.astermd.com';

/** Options accepted by {@link Config}. */
export interface ConfigOptions {
  /** OAuth2 client ID issued by AsterMD. Must be non-empty. */
  clientId: string;
  /** OAuth2 client secret corresponding to `clientId`. Must be non-empty. */
  clientSecret: string;
  /** Bare API hostname without scheme or path. Defaults to `api.astermd.com`. */
  baseHost?: string;
  /** Per-request timeout in seconds. Must be >= 1. Defaults to 10. */
  timeoutSeconds?: number;
}

/**
 * Immutable value object holding SDK configuration.
 *
 * Stores the OAuth2 credentials and connection settings every outbound request
 * needs. It is constructed once inside {@link AsterMDClient} and never mutated.
 * Validation happens eagerly in the constructor, so a misconfigured client fails
 * at boot rather than at its first network call.
 *
 * `baseHost` is a bare hostname. The SDK always prepends `https://` and appends
 * `/v1/{service}/{path}` itself - never pass a full URL.
 */
export class Config {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #baseHost: string;
  readonly #timeoutSeconds: number;

  /**
   * @param options Credentials and connection settings.
   * @throws {TypeError} If `clientId` or `clientSecret` is empty, if `baseHost`
   *   contains a scheme or a path, or if `timeoutSeconds` is below 1.
   */
  constructor(options: ConfigOptions) {
    const { clientId, clientSecret, baseHost = DEFAULT_BASE_HOST, timeoutSeconds = 10 } = options;

    if (clientId === '' || clientSecret === '') {
      throw new TypeError('clientId and clientSecret must be non-empty.');
    }

    if (baseHost.includes('://') || baseHost.includes('/')) {
      throw new TypeError(`baseHost must be a bare host (no scheme, no path). Got: ${baseHost}`);
    }

    if (timeoutSeconds < 1) {
      throw new TypeError('timeoutSeconds must be >= 1.');
    }

    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#baseHost = baseHost;
    this.#timeoutSeconds = timeoutSeconds;

    Object.freeze(this);
  }

  /**
   * Returns the OAuth2 client ID used to acquire JWT bearer tokens.
   *
   * @returns The client ID, guaranteed non-empty.
   */
  clientId(): string {
    return this.#clientId;
  }

  /**
   * Returns the OAuth2 client secret used to acquire JWT bearer tokens.
   *
   * @returns The client secret, guaranteed non-empty.
   */
  clientSecret(): string {
    return this.#clientSecret;
  }

  /**
   * Returns the bare API hostname used to build request URLs.
   *
   * Never contains a scheme or a path. {@link UrlBuilder} prepends `https://`
   * and appends `/v1/{service}/{path}` at request time.
   *
   * @returns The hostname, e.g. `api.astermd.com`.
   */
  baseHost(): string {
    return this.#baseHost;
  }

  /**
   * Returns the per-request HTTP timeout in seconds.
   *
   * Applied by {@link FetchHttpClient} as an `AbortSignal` deadline covering the
   * whole request. A custom {@link HttpClient} may use it at its own discretion.
   *
   * @returns The timeout in seconds, always >= 1.
   */
  timeoutSeconds(): number {
    return this.#timeoutSeconds;
  }

  /**
   * Builds the fully-qualified CDN URL for a media asset path returned by the API.
   *
   * API responses carry relative asset paths such as
   * `{org}/{channel}/products/{file}.png`. Pass one here to resolve it.
   *
   * Treat the result as a *fetch* URL, not a *serve* URL: download the asset
   * once, store it on your own filesystem or CDN, and serve your copy to end
   * users. Hot-linking the AsterMD CDN from a storefront is not supported and is
   * subject to rate limiting.
   *
   * @param path Relative asset path as returned by the API; a leading slash is
   *             optional and is trimmed.
   * @returns The fully-qualified URL.
   */
  assetUrl(path: string): string {
    return ASSET_BASE_URL + path.replace(/^\/+/, '');
  }
}

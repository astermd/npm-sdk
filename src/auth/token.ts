/**
 * Immutable value object holding a JWT bearer token and its server-stated
 * expiry.
 *
 * {@link TokenManager} builds one after a successful credential exchange and
 * hands it to a {@link TokenStore}. Before each request the manager calls
 * {@link Token.isExpired} to decide whether the cached token can be reused or a
 * fresh one must be acquired.
 *
 * The organisation the token authorises is encoded inside the JWT itself, which
 * is why no SDK method takes an organisation argument.
 */
export class Token {
  readonly #value: string;
  readonly #expiresAtMs: number;

  /**
   * @param value The raw JWT string, to be sent as `Authorization: Bearer <value>`.
   * @param expiresAt Expiry as declared by the token response's
   *                  `access_token_expiry` field. Copied, so a later mutation of
   *                  the caller's `Date` cannot change the token.
   */
  constructor(value: string, expiresAt: Date) {
    this.#value = value;
    this.#expiresAtMs = expiresAt.getTime();

    Object.freeze(this);
  }

  /**
   * Returns the raw JWT string.
   *
   * @returns The JWT, ready for use as a bearer credential.
   */
  value(): string {
    return this.#value;
  }

  /**
   * Returns the server-stated expiry.
   *
   * A fresh `Date` each call, so callers cannot mutate the token's state. Note
   * that the SDK treats the token as expired before this moment - see
   * {@link Token.isExpired}.
   *
   * @returns The expiry as declared in the token response.
   */
  expiresAt(): Date {
    return new Date(this.#expiresAtMs);
  }

  /**
   * Reports whether this token should be considered expired and replaced.
   *
   * The pre-buffer avoids a race where the token is valid when checked but
   * expires in transit before the server processes the request. The default 30
   * seconds means the SDK only trusts a token with at least half a minute of
   * validity left. Pass a custom value only when you know something specific
   * about clock skew in your environment.
   *
   * @param preBufferSeconds Seconds to subtract from the stated expiry when
   *   computing the effective cutoff.
   * @returns `true` when the token is at or past its effective expiry.
   */
  isExpired(preBufferSeconds = 30): boolean {
    return Date.now() >= this.#expiresAtMs - preBufferSeconds * 1000;
  }
}

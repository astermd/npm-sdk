import { ApiError } from './api-error.js';

/**
 * The calling organisation exceeded its request allowance (HTTP 429).
 *
 * When the server sent a `Retry-After` header, its value in seconds is available
 * on {@link RateLimitError.retryAfter} - wait at least that long before trying
 * again. The header is optional, so treat `null` as "back off on your own
 * schedule" rather than "retry immediately".
 */
export class RateLimitError extends ApiError {
  readonly #retryAfter: number | null;

  /**
   * @param message Human-readable summary from the envelope.
   * @param statusCode Always 429 in practice.
   * @param envelope The decoded response body.
   * @param retryAfter Seconds to wait, from the `Retry-After` header, or `null`
   *                   when the header was absent or not a plain integer.
   */
  constructor(message: string, statusCode: number, envelope: Record<string, unknown>, retryAfter: number | null) {
    super(message, statusCode, envelope);
    this.name = 'RateLimitError';
    this.#retryAfter = retryAfter;
  }

  /**
   * Returns the server-advised wait in seconds before retrying.
   *
   * @returns Seconds to wait, or `null` when the server did not say.
   */
  retryAfter(): number | null {
    return this.#retryAfter;
  }
}

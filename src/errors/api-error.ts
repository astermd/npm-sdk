import { AsterMDError } from './astermd-error.js';

/**
 * The API answered with a non-2xx status.
 *
 * This is the base for every status-carrying error and the class the SDK throws
 * for any status it does not map to something more specific - a 400, a 500, a
 * 502 from an upstream hiccup. The decoded response envelope is kept intact on
 * {@link ApiError.envelope} so an integrator can inspect whatever the server
 * chose to send alongside the status.
 *
 * Four subclasses cover the statuses worth branching on explicitly:
 * {@link AuthenticationError} (401), {@link NotFoundError} (404),
 * {@link ValidationError} (422), and {@link RateLimitError} (429).
 */
export class ApiError extends AsterMDError {
  readonly #statusCode: number;
  readonly #envelope: Readonly<Record<string, unknown>>;

  /**
   * @param message Human-readable message, taken from the envelope's `message`
   *                field when the server sent one, otherwise `HTTP {status}`.
   * @param statusCode The HTTP status code the server returned.
   * @param envelope The decoded response body. Copied and frozen, so a later
   *                 mutation of the caller's object cannot change the error.
   */
  constructor(message: string, statusCode: number, envelope: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.#statusCode = statusCode;
    this.#envelope = Object.freeze({ ...envelope });
  }

  /**
   * Returns the HTTP status code that caused this error.
   *
   * @returns The status code, e.g. `404` or `500`.
   */
  statusCode(): number {
    return this.#statusCode;
  }

  /**
   * Returns the decoded response envelope as the server sent it.
   *
   * Useful for surfacing a server-supplied message or an error code the SDK does
   * not model. The object is frozen; treat it as read-only.
   *
   * @returns The decoded body, or an empty object when the response had none.
   */
  envelope(): Readonly<Record<string, unknown>> {
    return this.#envelope;
  }
}

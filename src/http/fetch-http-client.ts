import { TransportError } from '../errors/index.js';
import type { HttpClient } from './http-client.js';

/**
 * The default {@link HttpClient}: the platform `fetch` plus a timeout.
 *
 * This is what {@link AsterMDClient} uses unless you inject something else. It
 * adds exactly two things to `fetch`. First, a deadline: every request carries an
 * `AbortSignal.timeout()` built from the configured `timeoutSeconds`, covering
 * connection and response together. Second, uniform failures: a DNS error, a
 * connection reset, a TLS failure, or a timeout all surface as
 * {@link TransportError} with the original error preserved on `cause`, so
 * integrators can catch one type instead of guessing at platform error shapes.
 *
 * It holds no connection state, so one instance is safely shared across
 * concurrent requests.
 */
export class FetchHttpClient implements HttpClient {
  readonly #timeoutSeconds: number;
  readonly #fetchImpl: typeof fetch;

  /**
   * @param timeoutSeconds Per-request deadline in seconds. Must be >= 1.
   * @param fetchImpl The `fetch` implementation to call. Defaults to the global
   *                  one; override it to supply an instrumented or stubbed
   *                  `fetch` without implementing the whole interface.
   * @throws {TypeError} If `timeoutSeconds` is below 1.
   */
  constructor(timeoutSeconds = 10, fetchImpl: typeof fetch = globalThis.fetch) {
    if (timeoutSeconds < 1) {
      throw new TypeError('timeoutSeconds must be >= 1.');
    }

    this.#timeoutSeconds = timeoutSeconds;
    this.#fetchImpl = fetchImpl;
  }

  /**
   * Sends the request through `fetch` under the configured deadline.
   *
   * @param request The request to send.
   * @returns The response as received, whatever its status.
   * @throws {TransportError} If the request aborts on the deadline or fails at
   *   the network layer.
   */
  async sendRequest(request: Request): Promise<Response> {
    try {
      return await this.#fetchImpl(request, {
        signal: AbortSignal.timeout(this.#timeoutSeconds * 1000),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new TransportError(`Request to ${request.url} timed out after ${this.#timeoutSeconds}s.`, {
          cause: error,
        });
      }

      const detail = error instanceof Error ? error.message : String(error);

      throw new TransportError(`Request to ${request.url} failed: ${detail}`, { cause: error });
    }
  }
}

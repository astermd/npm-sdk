import { AsterMDError } from './astermd-error.js';

/**
 * A request never reached the API, or its response never came back.
 *
 * Raised for DNS failures, TLS errors, connection resets, and timeouts - every
 * case where the SDK has no HTTP status to reason about. The originating error is
 * preserved on `cause`. There is no `statusCode()` here by design: nothing was
 * returned to have a status.
 *
 * These are usually worth retrying with backoff; an {@link ApiError} usually is
 * not.
 */
export class TransportError extends AsterMDError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransportError';
  }
}

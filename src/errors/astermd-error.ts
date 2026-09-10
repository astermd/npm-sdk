/**
 * Base class for every error the SDK raises.
 *
 * Catching `AsterMDError` catches everything this SDK can throw and nothing it
 * cannot, which makes it the right thing to guard an integration boundary with.
 * Two branches descend from it: {@link TransportError} for failures where no HTTP
 * response was ever received, and {@link ApiError} for everything the server
 * answered with a non-2xx status.
 *
 * The class is abstract - the SDK never throws it directly.
 */
export abstract class AsterMDError extends Error {
  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    // Restores the prototype chain so `instanceof` holds in downlevelled and
    // bundled output, where extending a built-in otherwise loses it.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'AsterMDError';

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    }
  }
}

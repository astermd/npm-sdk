import { ApiError } from './api-error.js';

/**
 * The request was well-formed but the server refused its contents (HTTP 422).
 *
 * The interesting part is {@link ValidationError.fieldErrors}, which maps each
 * rejected field to the messages the server produced for it - exactly the shape
 * a form needs to render inline errors next to the offending inputs.
 */
export class ValidationError extends ApiError {
  readonly #fieldErrors: Readonly<Record<string, string[]>>;

  /**
   * @param message Human-readable summary from the envelope.
   * @param statusCode Always 422 in practice.
   * @param envelope The decoded response body.
   * @param fieldErrors Field name → list of messages, extracted from the
   *                    envelope's `errors` key by {@link Transport}.
   */
  constructor(
    message: string,
    statusCode: number,
    envelope: Record<string, unknown>,
    fieldErrors: Record<string, string[]>,
  ) {
    super(message, statusCode, envelope);
    this.name = 'ValidationError';
    this.#fieldErrors = Object.freeze({ ...fieldErrors });
  }

  /**
   * Returns the per-field validation messages the server produced.
   *
   * @returns Field name → messages. Empty when the server sent no `errors` key.
   */
  fieldErrors(): Readonly<Record<string, string[]>> {
    return this.#fieldErrors;
  }
}

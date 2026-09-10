/** Options accepted by {@link Response}. */
export interface ResponseOptions<T> {
  /** HTTP status code of the response (200–299). */
  statusCode: number;
  /** Contents of the envelope's `data` key. */
  data: T;
  /** Contents of the envelope's `meta` key; may be empty. */
  meta: Record<string, unknown>;
  /** Human-readable `message` string from the envelope. */
  message: string;
  /** Raw response body, before decoding. */
  raw: string;
}

/**
 * Value object representing a successful API response with its envelope
 * already decoded.
 *
 * Every AsterMD response that returns HTTP 2xx is wrapped in a standard JSON
 * envelope:
 *
 * ```json
 * { "success": true, "message": "Record created.", "data": { }, "meta": { } }
 * ```
 *
 * {@link Transport} decodes that envelope and builds a `Response` from it.
 * `data()` holds the primary resource payload - `{ session: "<uuid>" }` for
 * session creation, for instance - while `meta()` carries pagination cursors and
 * other out-of-band information where the endpoint emits them.
 *
 * Non-2xx responses are never wrapped in this object; they raise
 * {@link ApiError} or one of its subclasses instead.
 *
 * The shape of `data()` varies by endpoint, so it defaults to an untyped record.
 * A caller who knows the shape may narrow it:
 *
 * ```ts
 * const patient = await client.patients().view<Patient>('p-1');
 * ```
 *
 * The instance and its top-level `data`/`meta` objects are frozen, which guards
 * against accidental reassignment or a stray `delete` on this response. That
 * freeze is shallow, though: an object or array nested inside `data()` is the
 * server's payload passed through unchanged, and remains as mutable as any
 * other object you receive from `JSON.parse`. Treat nested values as you would
 * any other deserialised response - copy before mutating if that matters to
 * you - rather than relying on this class to protect them.
 */
export class Response<T = Record<string, unknown>> {
  readonly #statusCode: number;
  readonly #data: T;
  readonly #meta: Readonly<Record<string, unknown>>;
  readonly #message: string;
  readonly #raw: string;

  /**
   * @param options The decoded envelope fields.
   */
  constructor(options: ResponseOptions<T>) {
    this.#statusCode = options.statusCode;
    this.#data = Object.freeze(Array.isArray(options.data) ? ([...options.data] as T) : { ...options.data });
    this.#meta = Object.freeze({ ...options.meta });
    this.#message = options.message;
    this.#raw = options.raw;

    Object.freeze(this);
  }

  /**
   * Returns the HTTP status code, always 200–299 for a `Response` instance.
   *
   * @returns The status code, e.g. `200` or `201`.
   */
  statusCode(): number {
    return this.#statusCode;
  }

  /**
   * Returns the primary resource payload from the envelope's `data` key.
   *
   * The shape varies by endpoint - see the TSDoc on the resource method you
   * called. Empty when the server returned no data.
   *
   * @returns The decoded `data` object.
   */
  data(): T {
    return this.#data;
  }

  /**
   * Returns the envelope's `meta` key, typically pagination information.
   *
   * Present on paginated list endpoints such as `products/list` and
   * `treatments/list`, where it may carry `total`, `per_page`, `current_page`,
   * and `last_page`. Empty for endpoints that emit no `meta` block.
   *
   * @returns The decoded `meta` object.
   */
  meta(): Readonly<Record<string, unknown>> {
    return this.#meta;
  }

  /**
   * Returns the human-readable `message` string from the envelope.
   *
   * Usually a short confirmation such as `"Session created."`. Empty when the
   * server omitted the field.
   *
   * @returns The envelope message, possibly empty.
   */
  message(): string {
    return this.#message;
  }

  /**
   * Returns the raw response body exactly as received, before decoding.
   *
   * Useful for low-level debugging. Do not log this value for endpoints carrying
   * PHI, such as `patients/health-information`.
   *
   * @returns The raw JSON body.
   */
  raw(): string {
    return this.#raw;
  }
}

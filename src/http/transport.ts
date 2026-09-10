import {
  ApiError,
  AsterMDError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  TransportError,
  ValidationError,
} from '../errors/index.js';
import { Response as ApiResponse } from '../response.js';
import type { FileUpload } from './file-upload.js';
import type { HttpClient } from './http-client.js';
import type { QueryParams, UrlBuilder } from './url-builder.js';

/** One outbound API call, described declaratively. */
export interface SendOptions {
  /** Service segment of the URL: `sales`, `auth`, or `platform`. */
  service: string;
  /** HTTP method in uppercase. */
  method: string;
  /** Path relative to `/v1/{service}`, with `{placeholder}` tokens. */
  path: string;
  /** Placeholder name → value, substituted into `path`. */
  pathParams?: Record<string, string | number>;
  /** Query string parameters. */
  query?: QueryParams;
  /**
   * Request body, serialised as JSON. An empty object is sent as `{}`, which
   * every AsterMD endpoint requires of an object-shaped body. Omit for no body.
   * Mutually exclusive with `file`.
   */
  body?: Record<string, unknown> | null;
  /** Additional headers, e.g. `x-phi-verification-token`. */
  headers?: Record<string, string>;
  /**
   * File to send as a `multipart/form-data` body under the field name `file`.
   * Mutually exclusive with `body`.
   */
  file?: FileUpload | null;
}

/** Collaborators {@link Transport} needs. */
export interface TransportOptions {
  /** The client all outbound calls go through. */
  httpClient: HttpClient;
  /** Builds request URLs. */
  urlBuilder: UrlBuilder;
  /**
   * Returns the current bearer token, or `null` for an unauthenticated request.
   * {@link TokenManager} passes a provider that always returns `null` for its own
   * credential exchange, which is what stops that call recursing.
   */
  tokenProvider: () => Promise<string | null>;
  /**
   * Invoked at most once per `send()` when the server answers 401. Should
   * refresh the token and resolve `true` to request a replay, or `false` to let
   * the 401 surface.
   */
  onUnauthorized: () => Promise<boolean>;
}

/**
 * The single HTTP chokepoint for every outbound API call.
 *
 * Each resource method delegates to {@link Transport.send}, which owns the whole
 * request lifecycle: URL construction, bearer-token attachment, request
 * building, body serialisation, dispatch through the {@link HttpClient} seam,
 * envelope decoding, and the mapping from HTTP status to error class. Resources
 * never see a `Request`, a `Response`, or a line of JSON - that separation is
 * what keeps seventeen resource classes trivial and testable.
 *
 * The 401-retry protocol is built in. On a 401 the transport calls
 * `onUnauthorized` once, which in the production wiring refreshes the token, and
 * replays the request if that resolves `true`. A second 401 raises
 * {@link AuthenticationError} with no further retry.
 *
 * Status mapping:
 *
 * - 200–299 → {@link Response} with the envelope decoded
 * - 401 → {@link AuthenticationError}
 * - 404 → {@link NotFoundError}
 * - 422 → {@link ValidationError}, with field errors extracted from `errors`
 * - 429 → {@link RateLimitError}, with `Retry-After` parsed when present
 * - anything else → {@link ApiError}
 * - no response at all → {@link TransportError}, from the {@link HttpClient}
 */
export class Transport {
  readonly #httpClient: HttpClient;
  readonly #urlBuilder: UrlBuilder;
  readonly #tokenProvider: () => Promise<string | null>;
  readonly #onUnauthorized: () => Promise<boolean>;

  /**
   * @param options The collaborators to use for every call.
   */
  constructor(options: TransportOptions) {
    this.#httpClient = options.httpClient;
    this.#urlBuilder = options.urlBuilder;
    this.#tokenProvider = options.tokenProvider;
    this.#onUnauthorized = options.onUnauthorized;
  }

  /**
   * Dispatches one API call and returns the decoded success envelope.
   *
   * On a 401 the token is refreshed and the call is replayed once before
   * {@link AuthenticationError} is raised.
   *
   * @param options The call to make.
   * @returns The decoded envelope; `data()` holds the resource payload.
   * @throws {TypeError} If both `body` and `file` are supplied.
   * @throws {AuthenticationError} On a 401 that a token refresh did not recover.
   * @throws {NotFoundError} On a 404.
   * @throws {ValidationError} On a 422; inspect `fieldErrors()`.
   * @throws {RateLimitError} On a 429; inspect `retryAfter()`.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async send<T = Record<string, unknown>>(options: SendOptions): Promise<ApiResponse<T>> {
    if (options.body != null && options.file != null) {
      throw new TypeError('A request carries either a JSON body or a file upload, not both.');
    }

    let response = await this.#dispatch(options);

    if (response.status === 401 && (await this.#onUnauthorized())) {
      void response.body?.cancel();
      response = await this.#dispatch(options);
    }

    return await this.#handle<T>(response);
  }

  /**
   * Builds and sends one attempt.
   *
   * A fresh `Request` is constructed on every call rather than reused across the
   * 401 replay. A request body is a single-use stream: sending an already-sent
   * `Request` again transmits an empty body, silently. Keeping the description
   * and materialising the request per attempt is what makes the replay correct.
   */
  async #dispatch(options: SendOptions): Promise<Response> {
    const url = this.#urlBuilder.build(options.service, options.path, options.pathParams ?? {}, options.query ?? {});

    const headers = new Headers({ Accept: 'application/json' });
    const token = await this.#tokenProvider();

    if (token !== null) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    for (const [name, value] of Object.entries(options.headers ?? {})) {
      headers.set(name, value);
    }

    let body: string | FormData | null = null;

    if (options.body != null) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    } else if (options.file != null) {
      // Every AsterMD endpoint that accepts bytes uses the field name `file`.
      // FormData sets the multipart content type and a fresh boundary itself.
      const form = new FormData();
      form.append(
        'file',
        new Blob([options.file.contents()], { type: options.file.mimeType() }),
        options.file.fileName(),
      );
      body = form;
    }

    try {
      return await this.#httpClient.sendRequest(new Request(url, { method: options.method, headers, body }));
    } catch (error) {
      if (error instanceof AsterMDError) {
        throw error;
      }

      const detail = error instanceof Error ? error.message : String(error);

      throw new TransportError(`Request to ${url} failed: ${detail}`, {
        cause: error,
      });
    }
  }

  async #handle<T>(response: Response): Promise<ApiResponse<T>> {
    let raw: string;

    try {
      raw = await response.text();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      throw new TransportError(`Reading the response body failed: ${detail}`, {
        cause: error,
      });
    }

    const envelope = decode(raw);
    const status = response.status;

    if (status >= 200 && status < 300) {
      return new ApiResponse<T>({
        statusCode: status,
        data: objectField(envelope, 'data') as T,
        meta: objectField(envelope, 'meta'),
        message: typeof envelope.message === 'string' ? envelope.message : '',
        raw,
      });
    }

    const message = typeof envelope.message === 'string' ? envelope.message : `HTTP ${status}`;

    switch (status) {
      case 401:
        throw new AuthenticationError(message, status, envelope);
      case 404:
        throw new NotFoundError(message, status, envelope);
      case 422:
        throw new ValidationError(message, status, envelope, fieldErrors(envelope));
      case 429:
        throw new RateLimitError(message, status, envelope, retryAfter(response));
      default:
        throw new ApiError(message, status, envelope);
    }
  }
}

/** Decodes a response body, treating anything unparseable as an empty envelope. */
function decode(raw: string): Record<string, unknown> {
  if (raw === '') {
    return {};
  }

  try {
    const decoded: unknown = JSON.parse(raw);

    return typeof decoded === 'object' && decoded !== null ? (decoded as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Reads one envelope field that should hold structured data.
 *
 * A list payload is preserved as a list - several endpoints return `data` as an
 * array - and anything scalar or missing becomes an empty object.
 */
function objectField(envelope: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = envelope[key];

  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Normalises the envelope's `errors` key into field name → messages. */
function fieldErrors(envelope: Record<string, unknown>): Record<string, string[]> {
  const errors = envelope.errors;

  // An array-shaped `errors` payload has only integer keys, which PHP skips.
  // Surfacing them as field names "0", "1" would be worse than reporting none.
  if (typeof errors !== 'object' || errors === null || Array.isArray(errors)) {
    return {};
  }

  const out: Record<string, string[]> = {};

  for (const [field, messages] of Object.entries(errors as Record<string, unknown>)) {
    if (Array.isArray(messages)) {
      out[field] = messages.filter((message): message is string => typeof message === 'string');
    } else if (typeof messages === 'string') {
      out[field] = [messages];
    } else if (typeof messages === 'object' && messages !== null) {
      // PHP's is_array also accepts a JSON object here (an associative array
      // on the PHP side); take its values the same way the array branch does.
      out[field] = Object.values(messages).filter((message): message is string => typeof message === 'string');
    }
  }

  return out;
}

/** Parses `Retry-After`, accepting only a plain integer count of seconds. */
function retryAfter(response: Response): number | null {
  const header = response.headers.get('Retry-After');

  return header !== null && /^\d+$/.test(header) ? Number(header) : null;
}

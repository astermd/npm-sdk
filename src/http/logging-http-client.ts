import { CurlFormatter } from './curl-formatter.js';
import type { HttpClient } from './http-client.js';
import { LogRedactor } from './log-redactor.js';

/**
 * Destination for debug log entries.
 *
 * Called once per request with a fully formatted entry - timestamp, curl
 * command, and response. Return a promise to have the SDK await the write. Any
 * error it throws is swallowed: a failing log must never fail an API call.
 */
export type DebugSink = (entry: string) => void | Promise<void>;

/** Collaborators {@link LoggingHttpClient} needs. */
export interface LoggingHttpClientOptions {
  /** The client to delegate the actual request to. */
  inner: HttpClient;
  /** Where formatted entries are written. */
  sink: DebugSink;
  /** IANA time zone for entry timestamps. Defaults to `UTC`. */
  timeZone?: string;
  /**
   * Strips credentials and PHI from each entry. Defaults to a
   * {@link LogRedactor}; pass `null` to log verbatim, including live bearer
   * tokens - never in production.
   */
  redactor?: LogRedactor | null;
}

/**
 * {@link HttpClient} decorator that logs every request and its response as a
 * curl command.
 *
 * Wraps any client, forwards each call to it unchanged, and captures the request
 * and response for debug logging. Each entry carries a timestamp, the request
 * rendered as a replayable curl command by {@link CurlFormatter}, and the HTTP
 * status plus response body.
 *
 * {@link AsterMDClient} applies this decorator *before* handing the client to
 * {@link TokenManager}, so one decorator covers the credential exchange as well
 * as every resource call. That also makes it the only place in the SDK that could
 * leak a credential, which is why a {@link LogRedactor} is attached by default.
 *
 * The response body is read from a clone and the caller receives a fresh response
 * built from the bytes already read, so `Transport` can still decode the
 * envelope. A sink that throws is ignored, and an asynchronous sink is awaited
 * before the response is returned.
 */
export class LoggingHttpClient implements HttpClient {
  readonly #inner: HttpClient;
  readonly #sink: DebugSink;
  readonly #redactor: LogRedactor | null;
  readonly #formatter: Intl.DateTimeFormat;

  /**
   * @param options The client to wrap and where to log.
   */
  constructor(options: LoggingHttpClientOptions) {
    this.#inner = options.inner;
    this.#sink = options.sink;
    this.#redactor = options.redactor === undefined ? new LogRedactor() : options.redactor;
    this.#formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: options.timeZone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23',
      timeZoneName: 'short',
    });
  }

  /**
   * Forwards the request to the inner client, then logs the exchange.
   *
   * @param request The request to send and log.
   * @returns The response, with its body still readable.
   * @throws The inner client's error, rethrown after being logged.
   */
  async sendRequest(request: Request): Promise<Response> {
    const timestamp = this.#timestamp();
    const curl = await CurlFormatter.format(request, this.#redactor);

    let response: Response;

    try {
      response = await this.#inner.sendRequest(request);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.#write(`[${timestamp}]\n${curl}\n\n# Transport error: ${detail}\n\n`);

      throw error;
    }

    // Read the body once, then hand the caller a response rebuilt from those
    // bytes. A response body is a single-use stream, so logging it would
    // otherwise leave Transport with nothing to decode.
    const raw = await response.clone().text();
    const shown = this.#redactor?.body(raw, this.#redactor.pathOf(request)) ?? raw;

    await this.#write(`[${timestamp}]\n${curl}\n\n# Response: HTTP ${response.status}\n${shown}\n\n`);

    // 204/205/304 must be constructed with a null body; an empty string is
    // still a body and the Response constructor rejects it.
    const nullBody = response.status === 204 || response.status === 205 || response.status === 304;

    return new Response(nullBody ? null : raw, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  async #write(entry: string): Promise<void> {
    try {
      await this.#sink(entry);
    } catch {
      // Losing a debug entry is never worth failing the request that produced it.
    }
  }

  /**
   * Formats the current instant as `YYYY-MM-DD HH:MM:SS.ffffff ZONE`.
   *
   * PHP logs microseconds; `Date` only resolves to milliseconds, so the
   * millisecond value is zero-padded to six digits to keep the column width and
   * the shape of the PHP entries.
   */
  #timestamp(): string {
    const now = new Date();
    const parts = new Map(this.#formatter.formatToParts(now).map(({ type, value }) => [type, value]));
    const micros = String(now.getMilliseconds()).padStart(3, '0').padEnd(6, '0');

    return (
      `${parts.get('year')!}-${parts.get('month')!}-${parts.get('day')!} ` +
      `${parts.get('hour')!}:${parts.get('minute')!}:${parts.get('second')!}.${micros} ` +
      `${parts.get('timeZoneName')!}`
    );
  }
}

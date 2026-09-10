/** Header names whose values are always replaced, compared case-insensitively. */
const SENSITIVE_HEADERS = new Set(['authorization', 'x-phi-verification-token']);

/** JSON field names whose values are always replaced, compared case-insensitively. */
const SENSITIVE_FIELDS = ['client_secret', 'access_token', 'refresh_token'];

/** Path fragments that mark an endpoint as carrying PII or PHI. */
const PHI_PATH_FRAGMENTS = ['/patients', '/extensions/identity-verify'];

/** Path fragments that mark a request body as raw file bytes. */
const BINARY_UPLOAD_FRAGMENTS = ['/intake-submissions/upload-file/', '/upload-file-multipart/part/'];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strips credentials and protected health information out of debug log entries.
 *
 * Debug logging renders every outbound request as a copy-pasteable curl command
 * (see {@link CurlFormatter}). Left untouched, those entries would contain the
 * bearer JWT, the client secret exchanged for it, and - on patient endpoints -
 * PHI. This class is the single place that decides what must never reach a log
 * sink, and {@link CurlFormatter} and {@link LoggingHttpClient} both apply it
 * whenever redaction is enabled.
 *
 * Redaction is **on by default**: constructing {@link AsterMDClient} with
 * `debug: true` produces safe logs. Pass `debugRedact: false` to get verbatim
 * output when you genuinely need to replay a request by hand - never in
 * production.
 *
 * Values replaced with {@link LogRedactor.PLACEHOLDER}:
 *
 * - the `Authorization` header value (the bearer JWT), scheme preserved;
 * - the `x-phi-verification-token` header value;
 * - the `client_secret` field of a token-exchange request body;
 * - the `access_token` and `refresh_token` fields of any response body.
 *
 * Bodies are dropped whole for `/patients/*` and `/extensions/identity-verify`,
 * which carry PII and PHI - a Social Security Number in the identity case - that
 * must not appear in a log under any circumstances.
 *
 * File-upload bodies are dropped too, for two reasons: the bytes of a scanned ID
 * or a consultation video are PHI, and rendering megabytes of binary into a curl
 * command would make the log unusable anyway. That covers the single-shot upload
 * endpoint and the multipart `part` endpoint. The multipart `initiate`, `finish`,
 * and `abort` bodies are small JSON control messages carrying no file contents,
 * so they are logged in full where they are useful.
 *
 * Redaction covers headers and bodies only - **the request URL is logged
 * verbatim**. Endpoints that take their input as a query parameter therefore log
 * that input, so entries for `extensions/email-verify`,
 * `extensions/geo-info`, `extensions/geo-blocklist`, and the address endpoints
 * contain the email address or IP address that was checked. Keep that in mind
 * when deciding where debug logs are written and how long they are kept.
 */
export class LogRedactor {
  /** Replacement text substituted for every redacted value. */
  static readonly PLACEHOLDER = '[REDACTED]';

  /** Marker written in place of a body dropped wholesale. */
  static readonly PHI_PLACEHOLDER = '[REDACTED - PHI endpoint]';

  /** Marker written in place of the raw file bytes of an upload. */
  static readonly UPLOAD_PLACEHOLDER = '[REDACTED - binary upload]';

  /**
   * Returns the loggable form of one request header value.
   *
   * A sensitive header keeps its name, so the log still shows the header was
   * sent, but its value is replaced. For `Authorization` the scheme survives -
   * `Bearer [REDACTED]` - because knowing the scheme helps when debugging and
   * carries no secret.
   *
   * @param name The header name as it appears on the request.
   * @param value The raw header value.
   * @returns The value to write to the log.
   */
  headerValue(name: string, value: string): string {
    if (!SENSITIVE_HEADERS.has(name.toLowerCase())) {
      return value;
    }

    const scheme = /^(\S+)\s+\S/.exec(value);

    return scheme === null ? LogRedactor.PLACEHOLDER : `${scheme[1]!} ${LogRedactor.PLACEHOLDER}`;
  }

  /**
   * Returns the loggable form of a request or response body.
   *
   * A body belonging to a PHI-carrying path, and the raw bytes sent to an upload
   * endpoint, are replaced entirely. Every other body has its sensitive JSON
   * fields rewritten in place, leaving the surrounding structure intact so the
   * entry stays readable and replayable apart from the redacted values.
   *
   * @param body The raw body as it would otherwise be logged.
   * @param path The request path, used to detect PHI and upload endpoints.
   * @returns The body to write to the log.
   */
  body(body: string, path: string): string {
    if (body === '') {
      return body;
    }

    if (this.isPhiPath(path)) {
      return LogRedactor.PHI_PLACEHOLDER;
    }

    if (this.isBinaryUploadPath(path)) {
      return LogRedactor.UPLOAD_PLACEHOLDER;
    }

    return this.#redactFields(body);
  }

  /**
   * Reports whether a path carries PII or PHI and must have its body dropped.
   *
   * @param path The request path, with or without the `/v1/{service}` prefix.
   * @returns `true` for a patient endpoint or the identity-verification endpoint.
   */
  isPhiPath(path: string): boolean {
    const lower = path.toLowerCase();

    return PHI_PATH_FRAGMENTS.some(fragment => lower.includes(fragment));
  }

  /**
   * Reports whether a path carries raw file bytes and must have its body dropped.
   *
   * True for the single-shot intake-submission upload endpoint and the multipart
   * `part` endpoint. The multipart `initiate`, `finish`, and `abort` endpoints
   * carry small JSON control messages, so they are excluded and their bodies stay
   * in the log where they help.
   *
   * @param path The request path, with or without the `/v1/{service}` prefix.
   * @returns `true` when the body is file contents rather than JSON.
   */
  isBinaryUploadPath(path: string): boolean {
    const lower = path.toLowerCase();

    return BINARY_UPLOAD_FRAGMENTS.some(fragment => lower.includes(fragment));
  }

  /**
   * Extracts the path from a request, for use with the methods above.
   *
   * @param request The request to inspect.
   * @returns The URL path, without the query string.
   */
  pathOf(request: Request): string {
    return new URL(request.url).pathname;
  }

  /**
   * Replaces the value of every sensitive JSON field found in the given text.
   *
   * Operates on the serialised form rather than decoding, so it works for
   * pretty-printed and compact JSON alike and never reorders or reformats a body
   * that is only partly JSON.
   */
  #redactFields(body: string): string {
    let out = body;

    for (const field of SENSITIVE_FIELDS) {
      const pattern = new RegExp(`("${escapeRegExp(field)}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi');
      out = out.replace(pattern, `$1"${LogRedactor.PLACEHOLDER}"`);
    }

    return out;
  }
}

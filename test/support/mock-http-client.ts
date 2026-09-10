import type { HttpClient } from '../../src/http/http-client.js';

/** One request as the mock observed it, with its body already read. */
export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Body as text. Empty string when there was no body. */
  body: string;
  /** Parsed multipart body, or `null` for a non-multipart request. */
  formData: FormData | null;
  /** The request object itself, for assertions the fields above cannot express. */
  raw: Request;
}

/**
 * Test double for {@link HttpClient}: records every request and returns a queued
 * sequence of responses. No test in this package performs real HTTP.
 */
export class MockHttpClient implements HttpClient {
  readonly requests: RecordedRequest[] = [];

  readonly #queue: Response[] = [];

  /** Queues one raw response body. */
  enqueue(status: number, body: string, headers: Record<string, string> = {}): void {
    // 204/205/304 must be constructed with a null body; an empty string is
    // still a body and the Response constructor rejects it for these statuses.
    const nullBody = status === 204 || status === 205 || status === 304;

    this.#queue.push(
      new Response(nullBody ? null : body, {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      }),
    );
  }

  /** Queues one JSON success envelope. */
  enqueueJson(status: number, envelope: unknown, headers: Record<string, string> = {}): void {
    this.enqueue(status, JSON.stringify(envelope), headers);
  }

  async sendRequest(request: Request): Promise<Response> {
    const clone = request.clone();
    const contentType = request.headers.get('content-type') ?? '';
    const isMultipart = contentType.startsWith('multipart/form-data');

    this.requests.push({
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      body: isMultipart ? '' : await clone.text(),
      formData: isMultipart ? await clone.formData() : null,
      raw: request,
    });

    const response = this.#queue.shift();

    if (response === undefined) {
      throw new Error('MockHttpClient has no queued response.');
    }

    return response;
  }

  lastRequest(): RecordedRequest {
    const last = this.requests.at(-1);

    if (last === undefined) {
      throw new Error('MockHttpClient has recorded no requests.');
    }

    return last;
  }
}

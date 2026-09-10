import type { LogRedactor } from './log-redactor.js';

/**
 * Converts a request into a copy-pasteable multi-line curl command.
 *
 * Used only by {@link LoggingHttpClient}, to produce log entries a developer can
 * replay in a terminal or import into an API client. The class has no instance
 * state and exposes a single static method.
 *
 * With a {@link LogRedactor} the rendered command has its credentials and PHI
 * stripped, so the entry stays structurally faithful while being safe to write to
 * disk or ship to an aggregator. Without one it is rendered verbatim and will
 * contain the live bearer token.
 *
 * Two details differ from the PHP formatter, both forced by the platform. The
 * method is asynchronous, because reading a request body is. And header names
 * appear lowercased, because `Headers` normalises them - curl does not care, and
 * the redactor compares names case-insensitively.
 */
export class CurlFormatter {
  /**
   * Renders the given request as a multi-line curl invocation.
   *
   * Each header becomes its own `--header '...'` line. A body is appended as
   * `--data '...'` with single quotes shell-escaped through the `'\''` idiom.
   * With no body, the trailing backslash continuation is stripped from the last
   * line so the command pastes cleanly.
   *
   * The request's body is read from a clone, so the request itself stays unread
   * and can still be sent. Reading the original would leave the real request with
   * an empty body.
   *
   * @param request The request to format.
   * @param redactor Applied to header values and the body before rendering. Pass
   *                 `null` or omit it to render verbatim.
   * @returns The multi-line curl command.
   */
  static async format(request: Request, redactor: LogRedactor | null = null): Promise<string> {
    const lines = [`curl --location --request ${request.method} '${request.url}' \\`];
    const headerLines: string[] = [];

    for (const [name, value] of request.headers.entries()) {
      const shown = redactor?.headerValue(name, value) ?? value;
      headerLines.push(`  --header '${name}: ${shown}' \\`);
    }

    let body = await readBody(request);

    if (redactor !== null) {
      body = redactor.body(body, redactor.pathOf(request));
    }

    if (body !== '') {
      lines.push(...headerLines);
      // Escape single quotes for the shell via the '\'' idiom.
      lines.push(`  --data '${body.replaceAll("'", String.raw`'\''`)}'`);
    } else {
      headerLines.forEach((line, index) => {
        lines.push(index === headerLines.length - 1 ? line.replace(/ \\$/, '') : line);
      });

      if (headerLines.length === 0) {
        lines[0] = lines[0]!.replace(/ \\$/, '');
      }
    }

    return lines.join('\n');
  }
}

/**
 * Reads a request body without consuming the request.
 *
 * A multipart body is reported as its placeholder length rather than decoded: the
 * redactor drops upload bodies by path anyway, and materialising the bytes only to
 * throw them away wastes memory on exactly the requests that are largest.
 */
async function readBody(request: Request): Promise<string> {
  if (request.body === null) {
    return '';
  }

  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.startsWith('multipart/form-data')) {
    return '[multipart/form-data]';
  }

  return await request.clone().text();
}

import { describe, expect, it, vi } from 'vitest';
import { TransportError } from '../../src/errors/index.js';
import type { HttpClient } from '../../src/http/http-client.js';
import { LogRedactor } from '../../src/http/log-redactor.js';
import { LoggingHttpClient } from '../../src/http/logging-http-client.js';

function inner(response: Response | Error): HttpClient {
  return {
    sendRequest: () => {
      if (response instanceof Error) {
        return Promise.reject(response);
      }

      return Promise.resolve(response);
    },
  };
}

describe('LoggingHttpClient', () => {
  it('returns the inner response unchanged', async () => {
    const expected = new Response('{"data":{}}', { status: 200 });
    const client = new LoggingHttpClient({
      inner: inner(expected),
      sink: () => undefined,
    });

    const actual = await client.sendRequest(new Request('https://api.astermd.com/v1/sales/x'));

    expect(actual.status).toBe(200);
    expect(await actual.text()).toBe('{"data":{}}');
  });

  it('leaves the response body readable by the caller after logging it', async () => {
    const entries: string[] = [];
    const client = new LoggingHttpClient({
      inner: inner(new Response('{"data":{"session":"s-1"}}', { status: 200 })),
      sink: entry => {
        entries.push(entry);
      },
    });

    const response = await client.sendRequest(new Request('https://api.astermd.com/v1/sales/x'));

    expect(await response.json()).toEqual({ data: { session: 's-1' } });
    expect(entries[0]).toContain('{"data":{"session":"s-1"}}');
  });

  it('writes one entry containing the timestamp, curl command, status and body', async () => {
    const entries: string[] = [];
    const client = new LoggingHttpClient({
      inner: inner(new Response('{"data":{}}', { status: 201 })),
      sink: entry => {
        entries.push(entry);
      },
    });

    await client.sendRequest(
      new Request('https://api.astermd.com/v1/sales/sessions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"data":{}}',
      }),
    );

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6} \S+]/);
    expect(entry).toContain("curl --location --request POST 'https://api.astermd.com/v1/sales/sessions/create'");
    expect(entry).toContain('# Response: HTTP 201');
  });

  it('redacts by default', async () => {
    const entries: string[] = [];
    const client = new LoggingHttpClient({
      inner: inner(new Response('{"access_token":"eyJ.fake"}', { status: 200 })),
      sink: entry => {
        entries.push(entry);
      },
    });

    await client.sendRequest(
      new Request('https://api.astermd.com/v1/auth/api-credentials/token', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer eyJ.live.jwt',
          'Content-Type': 'application/json',
        },
        body: '{"client_id":"test-client-id","client_secret":"test-client-secret"}',
      }),
    );

    const entry = entries[0]!;
    expect(entry).not.toContain('eyJ.live.jwt');
    expect(entry).not.toContain('test-client-secret');
    expect(entry).not.toContain('eyJ.fake');
    expect(entry).toContain('[REDACTED]');
  });

  it('logs verbatim when the redactor is explicitly null', async () => {
    const entries: string[] = [];
    const client = new LoggingHttpClient({
      inner: inner(new Response('{"ok":true}', { status: 200 })),
      sink: entry => {
        entries.push(entry);
      },
      redactor: null,
    });

    await client.sendRequest(
      new Request('https://api.astermd.com/v1/sales/x', {
        headers: { Authorization: 'Bearer eyJ.live.jwt' },
      }),
    );

    expect(entries[0]).toContain('Bearer eyJ.live.jwt');
  });

  it('drops a PHI response body from the log', async () => {
    const entries: string[] = [];
    const client = new LoggingHttpClient({
      inner: inner(new Response('{"data":{"first_name":"Jane"}}', { status: 200 })),
      sink: entry => {
        entries.push(entry);
      },
      redactor: new LogRedactor(),
    });

    await client.sendRequest(new Request('https://api.astermd.com/v1/sales/patients/view/p-1'));

    expect(entries[0]).not.toContain('Jane');
    expect(entries[0]).toContain('[REDACTED - PHI endpoint]');
  });

  it('logs a transport failure and rethrows it', async () => {
    const entries: string[] = [];
    const failure = new TransportError('connection reset');
    const client = new LoggingHttpClient({
      inner: inner(failure),
      sink: entry => {
        entries.push(entry);
      },
    });

    await expect(client.sendRequest(new Request('https://api.astermd.com/v1/sales/x'))).rejects.toBe(failure);
    expect(entries[0]).toContain('# Transport error: connection reset');
  });

  it('awaits an async sink', async () => {
    const entries: string[] = [];
    const sink = vi.fn(async (entry: string) => {
      await Promise.resolve();
      entries.push(entry);
    });
    const client = new LoggingHttpClient({
      inner: inner(new Response('{}', { status: 200 })),
      sink,
    });

    await client.sendRequest(new Request('https://api.astermd.com/v1/sales/x'));

    expect(entries).toHaveLength(1);
  });

  it('never lets a failing sink break the request', async () => {
    const client = new LoggingHttpClient({
      inner: inner(new Response('{"data":{}}', { status: 200 })),
      sink: () => {
        throw new Error('disk full');
      },
    });

    const response = await client.sendRequest(new Request('https://api.astermd.com/v1/sales/x'));

    expect(response.status).toBe(200);
  });

  it('logs and returns a usable response for a null-body status like 204', async () => {
    const entries: string[] = [];
    const client = new LoggingHttpClient({
      inner: inner(new Response(null, { status: 204 })),
      sink: entry => {
        entries.push(entry);
      },
    });

    const response = await client.sendRequest(
      new Request('https://api.astermd.com/v1/sales/sessions/delete/s-1', {
        method: 'DELETE',
      }),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('# Response: HTTP 204');
  });

  it('formats the timestamp in the configured time zone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T18:30:00.000Z'));

    try {
      const utc: string[] = [];
      const kolkata: string[] = [];

      await new LoggingHttpClient({
        inner: inner(new Response('{}', { status: 200 })),
        sink: entry => {
          utc.push(entry);
        },
      }).sendRequest(new Request('https://api.astermd.com/v1/sales/x'));

      await new LoggingHttpClient({
        inner: inner(new Response('{}', { status: 200 })),
        sink: entry => {
          kolkata.push(entry);
        },
        timeZone: 'Asia/Kolkata',
      }).sendRequest(new Request('https://api.astermd.com/v1/sales/x'));

      // 18:30 UTC is 00:00 the next day in Asia/Kolkata, so this pins both the
      // offset and the date rollover without asserting on an ICU zone label.
      expect(utc[0]).toContain('2026-09-08 18:30:00');
      expect(kolkata[0]).toContain('2026-09-09 00:00:00');
    } finally {
      vi.useRealTimers();
    }
  });
});

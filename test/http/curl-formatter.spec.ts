import { describe, expect, it } from 'vitest';
import { CurlFormatter } from '../../src/http/curl-formatter.js';
import { LogRedactor } from '../../src/http/log-redactor.js';

describe('CurlFormatter', () => {
  it('renders a request with a body as a replayable curl command', async () => {
    const request = new Request('https://api.astermd.com/v1/sales/sessions/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{"data":{}}',
    });

    const rendered = await CurlFormatter.format(request);

    expect(rendered).toContain("curl --location --request POST 'https://api.astermd.com/v1/sales/sessions/create' \\");
    expect(rendered).toContain("--header 'content-type: application/json' \\");
    expect(rendered).toContain(`--data '{"data":{}}'`);
    expect(rendered.endsWith('\\')).toBe(false);
  });

  it('strips the trailing continuation when there is no body', async () => {
    const request = new Request('https://api.astermd.com/v1/sales/products/list', {
      headers: { Accept: 'application/json' },
    });

    const rendered = await CurlFormatter.format(request);

    expect(rendered.endsWith('\\')).toBe(false);
    expect(rendered).toContain("--header 'accept: application/json'");
    expect(rendered).not.toContain('--data');
  });

  it('strips the continuation from the first line when there are no headers at all', async () => {
    const request = new Request('https://api.astermd.com/v1/sales/products/list');
    const stripped = new Request(request.url, { method: 'GET' });
    stripped.headers.delete('accept');

    const rendered = await CurlFormatter.format(stripped);

    expect(rendered.split('\n')[0]!.endsWith('\\')).toBe(false);
  });

  it('redacts credentials when a redactor is supplied', async () => {
    const request = new Request('https://api.astermd.com/v1/auth/api-credentials/token', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer eyJ.fake.jwt',
        'Content-Type': 'application/json',
      },
      body: '{"client_id":"test-client-id","client_secret":"test-client-secret"}',
    });

    const rendered = await CurlFormatter.format(request, new LogRedactor());

    expect(rendered).toContain("--header 'authorization: Bearer [REDACTED]' \\");
    expect(rendered).toContain('"client_secret":"[REDACTED]"');
    expect(rendered).not.toContain('eyJ.fake.jwt');
    expect(rendered).not.toContain('test-client-secret');
  });

  it('renders the live token when no redactor is supplied', async () => {
    const request = new Request('https://api.astermd.com/v1/sales/products/list', {
      headers: { Authorization: 'Bearer eyJ.fake.jwt' },
    });

    expect(await CurlFormatter.format(request)).toContain('Bearer eyJ.fake.jwt');
  });

  it('drops a PHI body and renders no --data line for it', async () => {
    const request = new Request('https://api.astermd.com/v1/sales/patients/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"first_name":"Jane","dob":"1990-01-15"}',
    });

    const rendered = await CurlFormatter.format(request, new LogRedactor());

    expect(rendered).toContain("--data '[REDACTED - PHI endpoint]'");
    expect(rendered).not.toContain('Jane');
  });

  it('shell-escapes single quotes in a body', async () => {
    const request = new Request('https://api.astermd.com/v1/sales/opportunities/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: `{"last_name":"O'Brien"}`,
    });

    const rendered = await CurlFormatter.format(request);

    expect(rendered).toContain(`--data '{"last_name":"O'\\''Brien"}'`);
  });

  it('leaves the original request readable, having not consumed its body', async () => {
    const request = new Request('https://api.astermd.com/v1/sales/sessions/create', {
      method: 'POST',
      body: '{"data":{}}',
    });

    await CurlFormatter.format(request);

    // bodyUsed must be checked before request.text() is called below, since
    // consuming the body here would set bodyUsed to true regardless of
    // whether CurlFormatter itself left it untouched.
    expect(request.bodyUsed).toBe(false);
    expect(await request.text()).toBe('{"data":{}}');
  });
});

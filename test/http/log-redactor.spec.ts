import { describe, expect, it } from 'vitest';
import { LogRedactor } from '../../src/http/log-redactor.js';

const redactor = new LogRedactor();

describe('LogRedactor.headerValue', () => {
  it('keeps the auth scheme visible and redacts only the credential', () => {
    expect(redactor.headerValue('Authorization', 'Bearer eyJhbGciOi.fake.jwt')).toBe('Bearer [REDACTED]');
  });

  it('redacts an Authorization value with no scheme', () => {
    expect(redactor.headerValue('Authorization', 'rawcredential')).toBe('[REDACTED]');
  });

  it('redacts the PHI verification token', () => {
    expect(redactor.headerValue('x-phi-verification-token', 'fake-phi-token')).toBe('[REDACTED]');
  });

  it('compares header names case-insensitively', () => {
    expect(redactor.headerValue('AUTHORIZATION', 'Bearer x')).toBe('Bearer [REDACTED]');
    expect(redactor.headerValue('X-PHI-Verification-Token', 'fake')).toBe('[REDACTED]');
  });

  it('passes ordinary headers through untouched', () => {
    expect(redactor.headerValue('Content-Type', 'application/json')).toBe('application/json');
    expect(redactor.headerValue('Accept', 'application/json')).toBe('application/json');
    expect(redactor.headerValue('User-Agent', 'Mozilla/5.0')).toBe('Mozilla/5.0');
  });
});

describe('LogRedactor.body field redaction', () => {
  it('redacts the client secret from a token-exchange body', () => {
    const body = '{"client_id":"test-client-id","client_secret":"test-client-secret"}';

    expect(redactor.body(body, '/v1/auth/api-credentials/token')).toBe(
      '{"client_id":"test-client-id","client_secret":"[REDACTED]"}',
    );
  });

  it('redacts access and refresh tokens from a response body', () => {
    const body = '{"data":{"access_token":"eyJ.fake","refresh_token":"r.fake","other":"kept"}}';

    expect(redactor.body(body, '/v1/auth/api-credentials/token')).toBe(
      '{"data":{"access_token":"[REDACTED]","refresh_token":"[REDACTED]","other":"kept"}}',
    );
  });

  it('redacts regardless of field-name case and surrounding whitespace', () => {
    expect(redactor.body('{"Client_Secret" : "s"}', '/v1/auth/x')).toBe('{"Client_Secret" : "[REDACTED]"}');
  });

  it('handles an escaped quote inside a redacted value', () => {
    expect(redactor.body('{"client_secret":"a\\"b","keep":"me"}', '/v1/auth/x')).toBe(
      '{"client_secret":"[REDACTED]","keep":"me"}',
    );
  });

  it('leaves a body with nothing sensitive untouched', () => {
    const body = '{"session":"s-1","items":[{"product_id":"p-1"}]}';

    expect(redactor.body(body, '/v1/sales/carts/create')).toBe(body);
  });

  it('passes an empty body straight through', () => {
    expect(redactor.body('', '/v1/sales/patients/create')).toBe('');
  });
});

describe('LogRedactor PHI paths', () => {
  it.each([
    ['/v1/sales/patients/create'],
    ['/v1/sales/patients/view/p-1'],
    ['/v1/sales/patients/update/p-1'],
    ['/v1/sales/patients/status/p-1'],
    ['/v1/sales/patients/health-information'],
    ['/v1/sales/patients/health-information/otp-verification'],
    ['/v1/platform/extensions/identity-verify'],
  ])('drops the body for %s', path => {
    expect(redactor.isPhiPath(path)).toBe(true);
    expect(redactor.body('{"first_name":"Jane","ssn":"000-00-0000"}', path)).toBe('[REDACTED - PHI endpoint]');
  });

  it.each([
    ['/v1/sales/sessions/create'],
    ['/v1/sales/opportunities/create'],
    ['/v1/platform/extensions/email-verify'],
    ['/v1/sales/treatments/create'],
  ])('does not treat %s as a PHI path', path => {
    expect(redactor.isPhiPath(path)).toBe(false);
  });
});

describe('LogRedactor upload paths', () => {
  it.each([
    ['/v1/sales/intake-submissions/upload-file/s-1'],
    ['/v1/sales/intake-submissions/upload-file-multipart/part/u-1'],
  ])('drops the raw bytes for %s', path => {
    expect(redactor.isBinaryUploadPath(path)).toBe(true);
    expect(redactor.body('\u0000\u0001binary', path)).toBe('[REDACTED - binary upload]');
  });

  it.each([
    ['/v1/sales/intake-submissions/upload-file-multipart/initiate/s-1'],
    ['/v1/sales/intake-submissions/upload-file-multipart/finish/u-1'],
    ['/v1/sales/intake-submissions/upload-file-multipart/abort/u-1'],
  ])('keeps the JSON control body for %s', path => {
    expect(redactor.isBinaryUploadPath(path)).toBe(false);
    expect(redactor.body('{"file_name":"scan.png"}', path)).toBe('{"file_name":"scan.png"}');
  });
});

describe('LogRedactor.pathOf', () => {
  it('extracts the path from a request, excluding the query string', () => {
    const request = new Request('https://api.astermd.com/v1/sales/patients/view/p-1?tz=UTC');

    expect(redactor.pathOf(request)).toBe('/v1/sales/patients/view/p-1');
  });
});

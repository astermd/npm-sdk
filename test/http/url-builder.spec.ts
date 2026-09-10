import { describe, expect, it } from 'vitest';
import { UrlBuilder } from '../../src/http/url-builder.js';

describe('UrlBuilder', () => {
  it('builds a URL against the default AsterMD host', () => {
    const builder = new UrlBuilder('api.astermd.com');

    expect(builder.build('sales', '/sessions/create')).toBe('https://api.astermd.com/v1/sales/sessions/create');
  });

  it('honours a custom host override', () => {
    const builder = new UrlBuilder('api.example.test');

    expect(builder.build('sales', '/sessions/create')).toBe('https://api.example.test/v1/sales/sessions/create');
  });

  it('substitutes path placeholders', () => {
    const builder = new UrlBuilder('api.astermd.com');

    expect(builder.build('sales', '/patients/view/{id}', { id: 'p-1' })).toBe(
      'https://api.astermd.com/v1/sales/patients/view/p-1',
    );
  });

  it('substitutes several placeholders and coerces numbers', () => {
    const builder = new UrlBuilder('api.astermd.com');

    expect(builder.build('sales', '/a/{first}/b/{second}', { first: 'x', second: 42 })).toBe(
      'https://api.astermd.com/v1/sales/a/x/b/42',
    );
  });

  it('percent-encodes path parameters, including the characters encodeURIComponent leaves alone', () => {
    const builder = new UrlBuilder('api.astermd.com');

    expect(builder.build('sales', '/teleforms/view/{id}', { id: 'a b/c?d#e' })).toBe(
      'https://api.astermd.com/v1/sales/teleforms/view/a%20b%2Fc%3Fd%23e',
    );
    expect(builder.build('sales', '/x/{id}', { id: "it's (a)*!" })).toBe(
      'https://api.astermd.com/v1/sales/x/it%27s%20%28a%29%2A%21',
    );
  });

  it('appends a query string when query params are given', () => {
    const builder = new UrlBuilder('api.astermd.com');

    expect(builder.build('sales', '/sessions/view', {}, { session_ids: 's-1,s-2' })).toBe(
      'https://api.astermd.com/v1/sales/sessions/view?session_ids=s-1%2Cs-2',
    );
  });

  it('preserves query param insertion order', () => {
    const builder = new UrlBuilder('api.astermd.com');

    expect(builder.build('sales', '/treatments/list', {}, { page: 2, per_page: 25 })).toBe(
      'https://api.astermd.com/v1/sales/treatments/list?page=2&per_page=25',
    );
  });

  it('encodes a space as + and a plus as %2B in the query string, as http_build_query does', () => {
    const builder = new UrlBuilder('api.astermd.com');

    expect(builder.build('platform', '/extensions/email-verify', {}, { email: 'a+tag@b.test' })).toBe(
      'https://api.astermd.com/v1/platform/extensions/email-verify?email=a%2Btag%40b.test',
    );
    expect(builder.build('platform', '/extensions/address-verify', {}, { address: '1 Main St' })).toBe(
      'https://api.astermd.com/v1/platform/extensions/address-verify?address=1+Main+St',
    );
  });

  it('escapes a tilde in the query string, as http_build_query does', () => {
    const builder = new UrlBuilder('api.astermd.com');

    expect(builder.build('sales', '/products/list', {}, { q: '~x' })).toBe(
      'https://api.astermd.com/v1/sales/products/list?q=%7Ex',
    );
  });

  it('serialises booleans as 1 and 0, as http_build_query does', () => {
    const builder = new UrlBuilder('api.astermd.com');

    expect(builder.build('sales', '/products/list', {}, { active: true, archived: false })).toBe(
      'https://api.astermd.com/v1/sales/products/list?active=1&archived=0',
    );
  });

  it('omits the question mark when there are no query params', () => {
    const builder = new UrlBuilder('api.astermd.com');

    expect(builder.build('sales', '/products/list', {}, {})).toBe('https://api.astermd.com/v1/sales/products/list');
  });

  it('leaves an unmatched placeholder in place rather than guessing', () => {
    const builder = new UrlBuilder('api.astermd.com');

    expect(builder.build('sales', '/patients/view/{id}', {})).toBe(
      'https://api.astermd.com/v1/sales/patients/view/{id}',
    );
  });
});

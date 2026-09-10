import { describe, expect, it } from 'vitest';
import { Geo } from '../../src/resource/geo.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

describe('Geo', () => {
  it('gets geo-info with the ip', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Geo(transport).info('203.0.113.7');

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/platform/extensions/geo-info?ip=203.0.113.7');
    expect(request.method).toBe('GET');
  });

  it('gets geo-blocklist with the ip', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Geo(transport).blocklist('203.0.113.7');

    expect(http.lastRequest().url).toBe('https://api.astermd.com/v1/platform/extensions/geo-blocklist?ip=203.0.113.7');
  });

  it('encodes an IPv6 address', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Geo(transport).info('2001:db8::1');

    expect(http.lastRequest().url).toBe('https://api.astermd.com/v1/platform/extensions/geo-info?ip=2001%3Adb8%3A%3A1');
  });
});

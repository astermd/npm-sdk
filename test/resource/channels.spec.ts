import { describe, expect, it } from 'vitest';
import { Channels } from '../../src/resource/channels.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

describe('Channels', () => {
  it.each([
    ['view', 'https://api.astermd.com/v1/sales/channels/view/c-1'],
    ['assignedProducts', 'https://api.astermd.com/v1/sales/channels/assigned-products/c-1'],
    ['details', 'https://api.astermd.com/v1/sales/channels/detail/c-1'],
  ])('%s gets %s', async (method, url) => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);
    const channels = new Channels(transport);

    await channels[method as 'view' | 'assignedProducts' | 'details']('c-1');

    const request = http.lastRequest();
    expect(request.url).toBe(url);
    expect(request.method).toBe('GET');
    expect(request.body).toBe('');
  });
});

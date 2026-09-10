import { describe, expect, it } from 'vitest';
import { Opportunities } from '../../src/resource/opportunities.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

describe('Opportunities', () => {
  it('posts opportunities/create with the payload, sessions included', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new Opportunities(transport).create({
      first_name: 'Jane',
      email: 'jane@example.test',
      sessions: ['s-1'],
    });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/opportunities/create');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({
      first_name: 'Jane',
      email: 'jane@example.test',
      sessions: ['s-1'],
    });
  });

  it('gets opportunities/view/{id}', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Opportunities(transport).view('o-1');

    expect(http.lastRequest().url).toBe('https://api.astermd.com/v1/sales/opportunities/view/o-1');
  });

  it('puts opportunities/update/{id} with the payload', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Opportunities(transport).update('o-1', { last_name: 'Doe' });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/opportunities/update/o-1');
    expect(request.method).toBe('PUT');
    expect(JSON.parse(request.body)).toEqual({ last_name: 'Doe' });
  });

  it('patches the status under the opportunity_status key', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Opportunities(transport).status('o-1', 'won');

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/opportunities/status/o-1');
    expect(request.method).toBe('PATCH');
    expect(JSON.parse(request.body)).toEqual({ opportunity_status: 'won' });
  });
});

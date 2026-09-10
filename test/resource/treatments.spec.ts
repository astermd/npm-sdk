import { describe, expect, it } from 'vitest';
import { Treatments } from '../../src/resource/treatments.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

describe('Treatments', () => {
  it('posts treatments/create with the payload', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new Treatments(transport).create({
      external_order_id: 'EXT-123',
      patient: { id: 'p-1' },
      product: { id: 'pr-1' },
    });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/treatments/create');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({
      external_order_id: 'EXT-123',
      patient: { id: 'p-1' },
      product: { id: 'pr-1' },
    });
  });

  it('gets treatments/view/{id}', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Treatments(transport).view('t-1');

    expect(http.lastRequest().url).toBe('https://api.astermd.com/v1/sales/treatments/view/t-1');
  });

  it('gets treatments/list with no query by default', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Treatments(transport).list();

    expect(http.lastRequest().url).toBe('https://api.astermd.com/v1/sales/treatments/list');
  });

  it('passes list filters through as query parameters', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Treatments(transport).list({ page: 2, per_page: 50, status: 'active' });

    expect(http.lastRequest().url).toBe(
      'https://api.astermd.com/v1/sales/treatments/list?page=2&per_page=50&status=active',
    );
  });
});

describe('Treatments.sync', () => {
  it('posts the session and order ids', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Treatments(transport).sync({ session: 's-1', orderIds: ['EXT-1', 'EXT-2'] });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/treatments/sync');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({
      session_id: 's-1',
      order_ids: ['EXT-1', 'EXT-2'],
    });
  });

  it('includes utm_source when given, including an empty string', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);
    http.enqueueJson(200, OK_ENVELOPE);

    const treatments = new Treatments(transport);

    await treatments.sync({ session: 's-1', orderIds: ['EXT-1'], utmSource: 'newsletter' });
    expect(JSON.parse(http.lastRequest().body)).toMatchObject({ utm_source: 'newsletter' });

    await treatments.sync({ session: 's-1', orderIds: ['EXT-1'], utmSource: '' });
    expect(JSON.parse(http.lastRequest().body)).toMatchObject({ utm_source: '' });
  });

  it('omits utm_source when it is not supplied', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Treatments(transport).sync({ session: 's-1', orderIds: ['EXT-1'] });

    const body = JSON.parse(http.lastRequest().body) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('utm_source');
  });

  it('forwards a non-empty user agent as a header and omits an empty one', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);
    http.enqueueJson(200, OK_ENVELOPE);

    const treatments = new Treatments(transport);

    await treatments.sync({
      session: 's-1',
      orderIds: ['EXT-1'],
      userAgent: 'Mozilla/5.0 (test)',
    });
    expect(http.lastRequest().headers['user-agent']).toBe('Mozilla/5.0 (test)');

    await treatments.sync({ session: 's-1', orderIds: ['EXT-1'], userAgent: '' });
    expect(http.lastRequest().headers['user-agent']).not.toBe('');
  });
});

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

    await new Treatments(transport).sync({
      session: 's-1',
      orderIds: ['EXT-1', 'EXT-2'],
      userAgent: 'Mozilla/5.0 (test)',
    });

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

    await treatments.sync({
      session: 's-1',
      orderIds: ['EXT-1'],
      userAgent: 'Mozilla/5.0 (test)',
      utmSource: 'newsletter',
    });
    expect(JSON.parse(http.lastRequest().body)).toMatchObject({ utm_source: 'newsletter' });

    await treatments.sync({
      session: 's-1',
      orderIds: ['EXT-1'],
      userAgent: 'Mozilla/5.0 (test)',
      utmSource: '',
    });
    expect(JSON.parse(http.lastRequest().body)).toMatchObject({ utm_source: '' });
  });

  it('omits utm_source when it is not supplied', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Treatments(transport).sync({ session: 's-1', orderIds: ['EXT-1'], userAgent: 'Mozilla/5.0 (test)' });

    const body = JSON.parse(http.lastRequest().body) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('utm_source');
  });

  it('forwards the required user agent as a header', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Treatments(transport).sync({
      session: 's-1',
      orderIds: ['EXT-1'],
      userAgent: 'Mozilla/5.0 (test)',
    });

    expect(http.lastRequest().headers['user-agent']).toBe('Mozilla/5.0 (test)');
  });

  it('throws TypeError for an empty user agent and sends no request', async () => {
    const { transport, http } = makeHarness();

    await expect(
      new Treatments(transport).sync({ session: 's-1', orderIds: ['EXT-1'], userAgent: '' }),
    ).rejects.toThrow(TypeError);
    expect(http.requests).toHaveLength(0);
  });

  it('throws TypeError for a missing user agent and sends no request', async () => {
    const { transport, http } = makeHarness();

    await expect(
      new Treatments(transport).sync({
        session: 's-1',
        orderIds: ['EXT-1'],
      } as unknown as Parameters<Treatments['sync']>[0]),
    ).rejects.toThrow(TypeError);
    expect(http.requests).toHaveLength(0);
  });

  it('includes payment when given, omitting unset optional fields', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Treatments(transport).sync({
      session: 's-1',
      orderIds: ['EXT-1'],
      userAgent: 'Mozilla/5.0 (test)',
      payment: { type: 'credit_card', preAuth: false },
    });

    expect(JSON.parse(http.lastRequest().body)).toMatchObject({
      payment: { type: 'credit_card', pre_auth: false },
    });
    const payment = (JSON.parse(http.lastRequest().body) as Record<string, unknown>).payment as Record<string, unknown>;
    expect(Object.keys(payment)).not.toContain('pre_auth_qa');
    expect(Object.keys(payment)).not.toContain('pre_auth_amount');
    expect(Object.keys(payment)).not.toContain('card');
  });

  it('includes a full payment with card and pre-auth details', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Treatments(transport).sync({
      session: 's-1',
      orderIds: ['EXT-1'],
      userAgent: 'Mozilla/5.0 (test)',
      payment: {
        type: 'credit_card',
        preAuth: true,
        preAuthQa: false,
        preAuthAmount: 100.99,
        card: { type: 'visa', bin: '411111', exp: '12/29' },
      },
    });

    expect(JSON.parse(http.lastRequest().body)).toMatchObject({
      payment: {
        type: 'credit_card',
        pre_auth: true,
        pre_auth_qa: false,
        pre_auth_amount: 100.99,
        card: { type: 'visa', bin: '411111', exp: '12/29' },
      },
    });
  });

  it('omits payment when it is not supplied', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Treatments(transport).sync({ session: 's-1', orderIds: ['EXT-1'], userAgent: 'Mozilla/5.0 (test)' });

    const body = JSON.parse(http.lastRequest().body) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('payment');
  });

  it('includes verification when given, with and without the id check', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Treatments(transport).sync({
      session: 's-1',
      orderIds: ['EXT-1'],
      userAgent: 'Mozilla/5.0 (test)',
      verification: {
        email: true,
        address: false,
        id: { verified: true, method: 'ssn', value: '1234' },
      },
    });

    expect(JSON.parse(http.lastRequest().body)).toMatchObject({
      verification: {
        email: true,
        address: false,
        id: { verified: true, method: 'ssn', value: '1234' },
      },
    });
  });

  it('omits verification when it is not supplied', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Treatments(transport).sync({ session: 's-1', orderIds: ['EXT-1'], userAgent: 'Mozilla/5.0 (test)' });

    const body = JSON.parse(http.lastRequest().body) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('verification');
  });
});

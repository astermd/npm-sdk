import { describe, expect, it } from 'vitest';
import { Sessions } from '../../src/resource/sessions.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

describe('Sessions.create', () => {
  it('posts an empty object body to sessions/create', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, { success: true, message: 'ok', data: { session: 's-1' } });

    const response = await new Sessions(transport).create();

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/sessions/create');
    expect(request.method).toBe('POST');
    expect(request.headers.authorization).toBe('Bearer test-jwt');
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.body).toBe('{}');
    expect(response.data()).toEqual({ session: 's-1' });
  });

  it('forwards a data payload unmodified', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new Sessions(transport).create({ data: { utm_source: 'newsletter', ref: 'abc' } });

    expect(JSON.parse(http.lastRequest().body)).toEqual({ utm_source: 'newsletter', ref: 'abc' });
  });

  it('forwards the visitor user agent and client IP as headers', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new Sessions(transport).create({
      userAgent: 'Mozilla/5.0 (test)',
      clientIp: '203.0.113.7',
    });

    const request = http.lastRequest();
    expect(request.headers['user-agent']).toBe('Mozilla/5.0 (test)');
    expect(request.headers['x-original-client-ip']).toBe('203.0.113.7');
  });

  it('omits the attribution headers when they are empty or absent', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);
    http.enqueueJson(201, OK_ENVELOPE);

    const sessions = new Sessions(transport);
    await sessions.create();
    expect(http.lastRequest().headers['x-original-client-ip']).toBeUndefined();

    await sessions.create({ userAgent: '', clientIp: '' });
    expect(http.lastRequest().headers['x-original-client-ip']).toBeUndefined();
  });
});

describe('Sessions.view', () => {
  it('gets sessions/view with the ids joined by commas', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Sessions(transport).view({ sessions: ['s-1', 's-2', 's-3'] });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/sessions/view?session_ids=s-1%2Cs-2%2Cs-3');
    expect(request.method).toBe('GET');
    expect(request.body).toBe('');
  });

  it('adds the tz query parameter when given', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Sessions(transport).view({ sessions: ['s-1'], tz: 'America/New_York' });

    expect(http.lastRequest().url).toBe(
      'https://api.astermd.com/v1/sales/sessions/view?session_ids=s-1&tz=America%2FNew_York',
    );
  });

  it('omits an empty tz', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Sessions(transport).view({ sessions: ['s-1'], tz: '' });

    expect(http.lastRequest().url).toBe('https://api.astermd.com/v1/sales/sessions/view?session_ids=s-1');
  });
});

describe('Sessions.update', () => {
  it('puts to sessions/update/{id} with the payload', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Sessions(transport).update('s-1', { utm_source: 'newsletter' });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/sessions/update/s-1');
    expect(request.method).toBe('PUT');
    expect(JSON.parse(request.body)).toEqual({ utm_source: 'newsletter' });
  });

  it('sends an empty object when no payload is given', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Sessions(transport).update('s-1');

    expect(http.lastRequest().body).toBe('{}');
  });

  it('percent-encodes an id in the path', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Sessions(transport).update('s 1/2');

    expect(http.lastRequest().url).toBe('https://api.astermd.com/v1/sales/sessions/update/s%201%2F2');
  });
});

describe('Sessions.delete', () => {
  it('deletes sessions/delete/{id} with no body', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Sessions(transport).delete('s-1');

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/sessions/delete/s-1');
    expect(request.method).toBe('DELETE');
    expect(request.body).toBe('');
    expect(request.headers['content-type']).toBeUndefined();
  });
});

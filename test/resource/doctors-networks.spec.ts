import { describe, expect, it } from 'vitest';
import { DoctorsNetworks } from '../../src/resource/doctors-networks.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

describe('DoctorsNetworks.sync validation', () => {
  it('accepts a payload carrying an opportunity_id', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new DoctorsNetworks(transport).sync({ opportunity_id: 'o-1' });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/doctors-networks/sync');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({ opportunity_id: 'o-1' });
  });

  it('accepts a payload carrying user_info with a first name and email', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new DoctorsNetworks(transport).sync({
      user_info: { first_name: 'Jane', email: 'jane@example.test' },
    });

    expect(JSON.parse(http.lastRequest().body)).toEqual({
      user_info: { first_name: 'Jane', email: 'jane@example.test' },
    });
  });

  it.each([
    ['an empty payload', {}],
    ['an empty opportunity_id', { opportunity_id: '' }],
    ['a non-string opportunity_id', { opportunity_id: 123 }],
    ['user_info with no email', { user_info: { first_name: 'Jane' } }],
    ['user_info with no first name', { user_info: { email: 'jane@example.test' } }],
    ['user_info with an empty first name', { user_info: { first_name: '', email: 'j@e.test' } }],
    ['user_info with an empty email', { user_info: { first_name: 'Jane', email: '' } }],
    ['user_info that is not an object', { user_info: 'Jane' }],
  ])('rejects %s', async (_label, payload) => {
    const { transport, http } = makeHarness();

    await expect(new DoctorsNetworks(transport).sync(payload)).rejects.toThrow(TypeError);
    await expect(new DoctorsNetworks(transport).sync(payload)).rejects.toThrow(
      /requires either opportunity_id or user_info with first_name \+ email/,
    );
    expect(http.requests).toHaveLength(0);
  });
});

describe('DoctorsNetworks.sync payload handling', () => {
  it('strips emit_opportunity before sending', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new DoctorsNetworks(transport).sync({
      opportunity_id: 'o-1',
      emit_opportunity: true,
      note: 'kept',
    });

    expect(JSON.parse(http.lastRequest().body)).toEqual({ opportunity_id: 'o-1', note: 'kept' });
  });

  it('does not mutate the payload the caller passed in', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);
    const payload = { opportunity_id: 'o-1', emit_opportunity: true };

    await new DoctorsNetworks(transport).sync(payload);

    expect(payload).toEqual({ opportunity_id: 'o-1', emit_opportunity: true });
  });

  it('forwards everything else unmodified', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new DoctorsNetworks(transport).sync({
      opportunity_id: 'o-1',
      user_info: { first_name: 'Jane', email: 'jane@example.test' },
      treatment: { id: 't-1' },
    });

    expect(JSON.parse(http.lastRequest().body)).toEqual({
      opportunity_id: 'o-1',
      user_info: { first_name: 'Jane', email: 'jane@example.test' },
      treatment: { id: 't-1' },
    });
  });
});

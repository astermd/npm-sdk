import { describe, expect, it } from 'vitest';
import { Carts } from '../../src/resource/carts.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

const items = [
  { product_id: 'p-1', variant_id: 'v-1', quantity: 2 },
  { product_id: 'p-2', quantity: 1 },
];

describe('Carts.create', () => {
  it('posts the session and items to carts/create', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new Carts(transport).create({ session: 's-1', items });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/carts/create');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({ session: 's-1', items });
  });

  it('accepts an empty item list', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new Carts(transport).create({ session: 's-1', items: [] });

    expect(JSON.parse(http.lastRequest().body)).toEqual({ session: 's-1', items: [] });
  });
});

describe('Carts.update', () => {
  it('puts the items to carts/update/{session}, with the session only in the path', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Carts(transport).update({ session: 's-1', items });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/carts/update/s-1');
    expect(request.method).toBe('PUT');
    expect(JSON.parse(request.body)).toEqual({ items });
  });
});

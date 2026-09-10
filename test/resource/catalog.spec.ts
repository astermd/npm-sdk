import { describe, expect, it } from 'vitest';
import { Categories } from '../../src/resource/categories.js';
import { LabTests } from '../../src/resource/lab-tests.js';
import { Medications } from '../../src/resource/medications.js';
import { Products } from '../../src/resource/products.js';
import { Shippings } from '../../src/resource/shippings.js';
import type { Transport } from '../../src/http/transport.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

interface Listable {
  list(query?: Record<string, string | number | boolean>): Promise<unknown>;
}

interface Viewable {
  view(id: string): Promise<unknown>;
}

const listable: [string, (t: Transport) => Listable, string][] = [
  ['Products', t => new Products(t), 'products'],
  ['Categories', t => new Categories(t), 'categories'],
  ['LabTests', t => new LabTests(t), 'lab-tests'],
  ['Medications', t => new Medications(t), 'medications'],
  ['Shippings', t => new Shippings(t), 'shippings'],
];

const viewable: [string, (t: Transport) => Viewable, string][] = [
  ['Products', t => new Products(t), 'products'],
  ['Categories', t => new Categories(t), 'categories'],
  ['LabTests', t => new LabTests(t), 'lab-tests'],
  ['Shippings', t => new Shippings(t), 'shippings'],
];

describe('catalog list endpoints', () => {
  it.each(listable)('%s.list gets /v1/sales/%s/list', async (_name, make, segment) => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await make(transport).list();

    const request = http.lastRequest();
    expect(request.url).toBe(`https://api.astermd.com/v1/sales/${segment}/list`);
    expect(request.method).toBe('GET');
    expect(request.headers.authorization).toBe('Bearer test-jwt');
  });

  it.each(listable)('%s.list forwards query parameters', async (_name, make, segment) => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await make(transport).list({ page: 3, per_page: 10 });

    expect(http.lastRequest().url).toBe(`https://api.astermd.com/v1/sales/${segment}/list?page=3&per_page=10`);
  });

  it('returns pagination in meta', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, {
      success: true,
      data: [{ id: 'p-1' }],
      meta: { total: 1, per_page: 10, current_page: 1, last_page: 1 },
    });

    const response = await new Products(transport).list();

    expect(response.data()).toEqual([{ id: 'p-1' }]);
    expect(response.meta()).toEqual({ total: 1, per_page: 10, current_page: 1, last_page: 1 });
  });
});

describe('catalog view endpoints', () => {
  it.each(viewable)('%s.view gets /v1/sales/%s/view/{id}', async (_name, make, segment) => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await make(transport).view('x-1');

    const request = http.lastRequest();
    expect(request.url).toBe(`https://api.astermd.com/v1/sales/${segment}/view/x-1`);
    expect(request.method).toBe('GET');
  });

  it('does not give Medications a view method, matching the API', () => {
    const { transport } = makeHarness();

    expect((new Medications(transport) as unknown as Record<string, unknown>).view).toBeUndefined();
  });
});

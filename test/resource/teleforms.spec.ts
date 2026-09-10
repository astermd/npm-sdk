import { describe, expect, it } from 'vitest';
import { Teleforms } from '../../src/resource/teleforms.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

describe('Teleforms', () => {
  it('gets teleforms/view-url/{form_json_identifier} by identifier', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Teleforms(transport).viewByIdentifier('intake-v3');

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/teleforms/view-url/intake-v3');
    expect(request.method).toBe('GET');
  });

  it('gets teleforms/view/{id} by id', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Teleforms(transport).view('tf-1');

    expect(http.lastRequest().url).toBe('https://api.astermd.com/v1/sales/teleforms/view/tf-1');
  });

  it('percent-encodes the identifier', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Teleforms(transport).viewByIdentifier('intake v3/latest');

    expect(http.lastRequest().url).toBe('https://api.astermd.com/v1/sales/teleforms/view-url/intake%20v3%2Flatest');
  });
});

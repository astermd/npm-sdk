import { describe, expect, it } from 'vitest';
import { IdentityCheck } from '../../src/enum/index.js';
import { Verification } from '../../src/resource/verification.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

describe('Verification address and email', () => {
  it('gets address-autofill with the search term', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Verification(transport).autofillAddress('1600 Penn');

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/platform/extensions/address-autofill?search=1600+Penn');
    expect(request.method).toBe('GET');
  });

  it('gets address-verify with the address', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Verification(transport).verifyAddress('1 Main St, Springfield');

    expect(http.lastRequest().url).toBe(
      'https://api.astermd.com/v1/platform/extensions/address-verify?address=1+Main+St%2C+Springfield',
    );
  });

  it('gets email-verify with the email, encoding a plus correctly', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Verification(transport).verifyEmail('jane+tag@example.test');

    expect(http.lastRequest().url).toBe(
      'https://api.astermd.com/v1/platform/extensions/email-verify?email=jane%2Btag%40example.test',
    );
  });
});

describe('Verification.verifyIdentity', () => {
  it('posts the check slug with the payload', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Verification(transport).verifyIdentity(IdentityCheck.DobVerify, {
      patient_id: 'p-1',
      dob: '1990-01-15',
    });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/platform/extensions/identity-verify');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({
      slug: 'dob_verify',
      patient_id: 'p-1',
      dob: '1990-01-15',
    });
  });

  it.each([
    [IdentityCheck.Crosscheck, 'crosscheck'],
    [IdentityCheck.DobVerify, 'dob_verify'],
    [IdentityCheck.SsnVerify, 'ssn_verify'],
  ])('sends %s as the slug %s', async (check, slug) => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Verification(transport).verifyIdentity(check, {});

    expect(JSON.parse(http.lastRequest().body)).toEqual({ slug });
  });

  it('does not let the payload override the slug', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Verification(transport).verifyIdentity(IdentityCheck.SsnVerify, {
      slug: 'crosscheck',
    });

    expect(JSON.parse(http.lastRequest().body)).toEqual({ slug: 'ssn_verify' });
  });
});

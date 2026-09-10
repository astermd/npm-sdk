import { describe, expect, it } from 'vitest';
import { Patients } from '../../src/resource/patients.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

describe('Patients', () => {
  it('posts patients/create with the payload', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new Patients(transport).create({ first_name: 'Jane', email: 'jane@example.test' });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/patients/create');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({ first_name: 'Jane', email: 'jane@example.test' });
  });

  it('gets patients/view/{id}', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Patients(transport).view('p-1');

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/patients/view/p-1');
    expect(request.method).toBe('GET');
  });

  it('puts patients/update/{id} with the payload', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Patients(transport).update('p-1', { phone: '+15550100' });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/patients/update/p-1');
    expect(request.method).toBe('PUT');
    expect(JSON.parse(request.body)).toEqual({ phone: '+15550100' });
  });

  it('patches patients/status/{id} with a status key', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Patients(transport).status('p-1', 'active');

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/patients/status/p-1');
    expect(request.method).toBe('PATCH');
    expect(JSON.parse(request.body)).toEqual({ status: 'active' });
  });
});

describe('Patients.submitHealthInformation', () => {
  it('posts to patients/health-information', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new Patients(transport).submitHealthInformation({
      data: { patient: { id: 'p-1' }, conditions: ['none'] },
    });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/patients/health-information');
    expect(request.method).toBe('POST');
    expect(request.headers['x-phi-verification-token']).toBeUndefined();
    expect(JSON.parse(request.body)).toEqual({ patient: { id: 'p-1' }, conditions: ['none'] });
  });

  it('sends the PHI verification token as a header when given', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new Patients(transport).submitHealthInformation({
      data: { patient: { id: 'p-1' } },
      phiVerificationToken: 'fake-phi-token',
    });

    expect(http.lastRequest().headers['x-phi-verification-token']).toBe('fake-phi-token');
  });

  it('posts the OTP payload to the otp-verification endpoint', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new Patients(transport).verifyHealthInformationOtp({ patient_id: 'p-1', otp: '000000' });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/patients/health-information/otp-verification');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({ patient_id: 'p-1', otp: '000000' });
  });
});

import { describe, expect, it } from 'vitest';
import { Event } from '../../src/enum/index.js';
import { IntakeSubmissions } from '../../src/resource/intake-submissions.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

const data = [
  {
    id: 'name-1',
    name: 'name',
    label: 'Full name',
    type: 'text',
    value: [{ value: 'Jane' }],
  },
  {
    id: 'dob-1',
    name: 'dob',
    label: 'Date of birth',
    type: 'date',
    value: [{ value: '1990-01-15' }],
  },
];

describe('IntakeSubmissions.view', () => {
  it('gets intake-submissions/view/{id} with the teleform id as a query param', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new IntakeSubmissions(transport).view({ id: 'is-1', teleformId: 'tf-1' });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/intake-submissions/view/is-1?teleform_id=tf-1');
    expect(request.method).toBe('GET');
  });
});

describe('IntakeSubmissions.create', () => {
  it('posts the session, event, teleform id and answers', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new IntakeSubmissions(transport).create({
      session: 's-1',
      event: Event.PreQualifyingInitiated,
      teleformId: 'tf-1',
      data,
    });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/intake-submissions/create');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({
      session: 's-1',
      event: 'pre_qualifying_initiated',
      teleform_id: 'tf-1',
      data,
    });
  });

  it('omits progress when it is not supplied', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new IntakeSubmissions(transport).create({
      session: 's-1',
      event: Event.IntakeInitiated,
      teleformId: 'tf-1',
      data,
    });

    const body = JSON.parse(http.lastRequest().body) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('progress');
  });

  it('includes progress when supplied', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new IntakeSubmissions(transport).create({
      session: 's-1',
      event: Event.IntakeInitiated,
      teleformId: 'tf-1',
      data,
      progress: { current_step: 2, total_steps: 6 },
    });

    expect(JSON.parse(http.lastRequest().body)).toMatchObject({
      progress: { current_step: 2, total_steps: 6 },
    });
  });

  it.each([
    [Event.PreQualifyingInitiated, 'pre_qualifying_initiated'],
    [Event.PreQualifyingInProgress, 'pre_qualifying_inprogress'],
    [Event.PreQualifyingCompleted, 'pre_qualifying_completed'],
    [Event.IntakeInitiated, 'intake_initiated'],
    [Event.IntakeInProgress, 'intake_inprogress'],
    [Event.IntakeCompleted, 'intake_completed'],
  ])('sends %s as the wire value %s', async (event, wire) => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new IntakeSubmissions(transport).create({
      session: 's-1',
      event,
      teleformId: 'tf-1',
      data: [],
    });

    expect(JSON.parse(http.lastRequest().body)).toMatchObject({ event: wire });
  });
});

describe('IntakeSubmissions.update', () => {
  it('puts to intake-submissions/update/{session} with the session in the body too', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new IntakeSubmissions(transport).update({
      session: 's-1',
      event: Event.IntakeCompleted,
      teleformId: 'tf-1',
      data,
    });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/intake-submissions/update/s-1');
    expect(request.method).toBe('PUT');
    expect(JSON.parse(request.body)).toEqual({
      session: 's-1',
      event: 'intake_completed',
      teleform_id: 'tf-1',
      data,
    });
  });

  it('includes progress when supplied', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new IntakeSubmissions(transport).update({
      session: 's-1',
      event: Event.IntakeInProgress,
      teleformId: 'tf-1',
      data,
      progress: { current_step: 4 },
    });

    expect(JSON.parse(http.lastRequest().body)).toMatchObject({ progress: { current_step: 4 } });
  });
});

import { describe, expect, it } from 'vitest';
import { CheckoutEvent, Event, IdentityCheck } from '../../src/enum/index.js';

describe('Event', () => {
  it('maps every case to its wire value', () => {
    expect(Event).toEqual({
      PreQualifyingInitiated: 'pre_qualifying_initiated',
      PreQualifyingInProgress: 'pre_qualifying_inprogress',
      PreQualifyingCompleted: 'pre_qualifying_completed',
      IntakeInitiated: 'intake_initiated',
      IntakeInProgress: 'intake_inprogress',
      IntakeCompleted: 'intake_completed',
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(Event)).toBe(true);
  });

  it('accepts a bare string literal where the union type is expected', () => {
    const event: Event = 'intake_completed';

    expect(event).toBe(Event.IntakeCompleted);
  });
});

describe('CheckoutEvent', () => {
  it('maps every case to its wire value', () => {
    expect(CheckoutEvent).toEqual({
      CheckoutVisited: 'checkout_visited',
      UpsellOffered: 'upsell_offered',
      UpsellAccepted: 'upsell_accepted',
      UpsellDeclined: 'upsell_declined',
      OrderPlaced: 'order_placed',
      OrderDeclined: 'order_declined',
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CheckoutEvent)).toBe(true);
  });
});

describe('IdentityCheck', () => {
  it('maps every case to its wire value', () => {
    expect(IdentityCheck).toEqual({
      Crosscheck: 'crosscheck',
      DobVerify: 'dob_verify',
      SsnVerify: 'ssn_verify',
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(IdentityCheck)).toBe(true);
  });
});

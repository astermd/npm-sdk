import { describe, expect, it } from 'vitest';
import {
  ApiError,
  AsterMDError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  TransportError,
  ValidationError,
} from '../../src/errors/index.js';

describe('error hierarchy', () => {
  it('roots every SDK error at AsterMDError', () => {
    const errors = [
      new TransportError('boom'),
      new ApiError('bad', 500, {}),
      new AuthenticationError('unauthorised', 401, {}),
      new NotFoundError('missing', 404, {}),
      new ValidationError('invalid', 422, {}, {}),
      new RateLimitError('slow down', 429, {}, 30),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(AsterMDError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('places status-carrying errors under ApiError and transport errors outside it', () => {
    expect(new AuthenticationError('u', 401, {})).toBeInstanceOf(ApiError);
    expect(new NotFoundError('n', 404, {})).toBeInstanceOf(ApiError);
    expect(new ValidationError('v', 422, {}, {})).toBeInstanceOf(ApiError);
    expect(new RateLimitError('r', 429, {}, null)).toBeInstanceOf(ApiError);
    expect(new TransportError('t')).not.toBeInstanceOf(ApiError);
  });

  it('names each error after its class', () => {
    expect(new TransportError('t').name).toBe('TransportError');
    expect(new ApiError('a', 500, {}).name).toBe('ApiError');
    expect(new AuthenticationError('a', 401, {}).name).toBe('AuthenticationError');
    expect(new NotFoundError('n', 404, {}).name).toBe('NotFoundError');
    expect(new ValidationError('v', 422, {}, {}).name).toBe('ValidationError');
    expect(new RateLimitError('r', 429, {}, 1).name).toBe('RateLimitError');
  });

  it('exposes the status code and the decoded envelope on ApiError', () => {
    const error = new ApiError('Server exploded', 503, { success: false, message: 'nope' });

    expect(error.statusCode()).toBe(503);
    expect(error.envelope()).toEqual({ success: false, message: 'nope' });
    expect(error.message).toBe('Server exploded');
  });

  it('does not let a caller mutate the envelope it handed in', () => {
    const envelope: Record<string, unknown> = { message: 'original' };
    const error = new ApiError('m', 500, envelope);

    envelope.message = 'tampered';

    expect(error.envelope()).toEqual({ message: 'original' });
    expect(() => {
      (error.envelope() as Record<string, unknown>).message = 'tampered';
    }).toThrow(TypeError);
  });

  it('exposes field errors on ValidationError', () => {
    const error = new ValidationError(
      'Unprocessable',
      422,
      { errors: {} },
      {
        email: ['The email field is required.'],
        dob: ['Must be a valid date.', 'Must be in the past.'],
      },
    );

    expect(error.fieldErrors()).toEqual({
      email: ['The email field is required.'],
      dob: ['Must be a valid date.', 'Must be in the past.'],
    });
  });

  it('exposes retryAfter on RateLimitError, including when the header was absent', () => {
    expect(new RateLimitError('slow', 429, {}, 42).retryAfter()).toBe(42);
    expect(new RateLimitError('slow', 429, {}, null).retryAfter()).toBeNull();
  });

  it('carries the underlying cause on TransportError', () => {
    const cause = new Error('ECONNRESET');
    const error = new TransportError('network failure', { cause });

    expect(error.cause).toBe(cause);
  });

  it('survives being caught across a rethrow', () => {
    const thrown = (): never => {
      throw new NotFoundError('Patient not found', 404, { message: 'Patient not found' });
    };

    try {
      thrown();
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).statusCode()).toBe(404);
      return;
    }

    throw new Error('expected NotFoundError to be thrown');
  });
});

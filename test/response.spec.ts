import { describe, expect, it } from 'vitest';
import { Response as ApiResponse } from '../src/response.js';

const raw = '{"success":true,"message":"Session created.","data":{"session":"s-1"},"meta":{"total":1}}';

describe('Response', () => {
  it('exposes every field of the decoded envelope', () => {
    const response = new ApiResponse({
      statusCode: 201,
      data: { session: 's-1' },
      meta: { total: 1 },
      message: 'Session created.',
      raw,
    });

    expect(response.statusCode()).toBe(201);
    expect(response.data()).toEqual({ session: 's-1' });
    expect(response.meta()).toEqual({ total: 1 });
    expect(response.message()).toBe('Session created.');
    expect(response.raw()).toBe(raw);
  });

  it('narrows data through its type parameter', () => {
    const response = new ApiResponse<{ session: string }>({
      statusCode: 200,
      data: { session: 's-2' },
      meta: {},
      message: '',
      raw: '{}',
    });

    const session: string = response.data().session;

    expect(session).toBe('s-2');
  });

  it('is frozen and does not expose mutable internals', () => {
    const data = { session: 's-3' };
    const response = new ApiResponse({ statusCode: 200, data, meta: {}, message: '', raw: '{}' });

    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.data())).toBe(true);
    expect(Object.isFrozen(response.meta())).toBe(true);
  });

  it('tolerates an empty envelope', () => {
    const response = new ApiResponse({ statusCode: 204, data: {}, meta: {}, message: '', raw: '' });

    expect(response.data()).toEqual({});
    expect(response.meta()).toEqual({});
    expect(response.message()).toBe('');
    expect(response.raw()).toBe('');
  });

  it('does not freeze the object the caller handed in', () => {
    const data = { session: 's-4' };
    new ApiResponse({ statusCode: 200, data, meta: {}, message: '', raw: '{}' });

    expect(Object.isFrozen(data)).toBe(false);
    data.session = 'mutated';
    expect(data.session).toBe('mutated');
  });

  it('preserves a list-shaped data payload as an array', () => {
    const response = new ApiResponse<{ id: string }[]>({
      statusCode: 200,
      data: [{ id: 'p-1' }, { id: 'p-2' }],
      meta: {},
      message: '',
      raw: '{}',
    });

    expect(Array.isArray(response.data())).toBe(true);
    expect(response.data()).toEqual([{ id: 'p-1' }, { id: 'p-2' }]);
    expect(Object.isFrozen(response.data())).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Token } from '../../src/auth/token.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('Token', () => {
  it('exposes its value and expiry', () => {
    const expiresAt = new Date('2026-09-08T12:00:00.000Z');
    const token = new Token('fake-jwt-value', expiresAt);

    expect(token.value()).toBe('fake-jwt-value');
    expect(token.expiresAt().toISOString()).toBe('2026-09-08T12:00:00.000Z');
  });

  it('is frozen and does not leak a mutable Date', () => {
    const expiresAt = new Date('2026-09-08T12:00:00.000Z');
    const token = new Token('fake-jwt-value', expiresAt);

    expiresAt.setFullYear(2030);

    expect(Object.isFrozen(token)).toBe(true);
    expect(token.expiresAt().getUTCFullYear()).toBe(2026);

    token.expiresAt().setFullYear(2031);
    expect(token.expiresAt().getUTCFullYear()).toBe(2026);
  });

  it('is not expired well before its stated expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T11:00:00.000Z'));

    expect(new Token('t', new Date('2026-09-08T12:00:00.000Z')).isExpired()).toBe(false);
  });

  it('is expired at its stated expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T12:00:00.000Z'));

    expect(new Token('t', new Date('2026-09-08T12:00:00.000Z')).isExpired()).toBe(true);
  });

  it('treats the token as expired 30 seconds early by default, guarding clock skew', () => {
    vi.useFakeTimers();
    const expiresAt = new Date('2026-09-08T12:00:00.000Z');

    vi.setSystemTime(new Date('2026-09-08T11:59:29.000Z'));
    expect(new Token('t', expiresAt).isExpired()).toBe(false);

    vi.setSystemTime(new Date('2026-09-08T11:59:30.000Z'));
    expect(new Token('t', expiresAt).isExpired()).toBe(true);
  });

  it('honours a custom pre-buffer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T11:55:00.000Z'));
    const token = new Token('t', new Date('2026-09-08T12:00:00.000Z'));

    expect(token.isExpired(0)).toBe(false);
    expect(token.isExpired(299)).toBe(false);
    expect(token.isExpired(300)).toBe(true);
  });
});

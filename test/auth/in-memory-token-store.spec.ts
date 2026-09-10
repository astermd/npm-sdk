import { describe, expect, it } from 'vitest';
import { InMemoryTokenStore } from '../../src/auth/in-memory-token-store.js';
import { Token } from '../../src/auth/token.js';

describe('InMemoryTokenStore', () => {
  it('starts empty', async () => {
    expect(await new InMemoryTokenStore().get()).toBeNull();
  });

  it('returns what was put into it', async () => {
    const store = new InMemoryTokenStore();
    const token = new Token('fake-jwt', new Date('2026-09-08T12:00:00.000Z'));

    await store.put(token);

    expect(await store.get()).toBe(token);
  });

  it('replaces the previous token on a second put', async () => {
    const store = new InMemoryTokenStore();
    const second = new Token('second', new Date('2026-09-08T13:00:00.000Z'));

    await store.put(new Token('first', new Date('2026-09-08T12:00:00.000Z')));
    await store.put(second);

    expect(await store.get()).toBe(second);
  });

  it('empties on clear', async () => {
    const store = new InMemoryTokenStore();
    await store.put(new Token('fake-jwt', new Date('2026-09-08T12:00:00.000Z')));

    await store.clear();

    expect(await store.get()).toBeNull();
  });
});

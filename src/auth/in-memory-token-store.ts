import type { Token } from './token.js';
import type { TokenStore } from './token-store.js';

/**
 * The default {@link TokenStore}: keeps the token in memory for the life of the
 * process.
 *
 * Right for a long-running server - an Express or Fastify app, a worker - where
 * one credential exchange serves every request until the token expires. Nothing
 * is written anywhere, so nothing can leak to disk.
 *
 * Wrong where each request runs in a fresh process or isolate, since the cache
 * dies with it and every request pays for its own token exchange. Use
 * {@link FileTokenStore} or your own {@link TokenStore} there.
 */
export class InMemoryTokenStore implements TokenStore {
  #token: Token | null = null;

  /**
   * Returns the token held in memory, or `null` before the first exchange.
   *
   * @returns The cached token, or `null`.
   */
  get(): Promise<Token | null> {
    return Promise.resolve(this.#token);
  }

  /**
   * Replaces the token held in memory.
   *
   * @param token The token to cache.
   */
  put(token: Token): Promise<void> {
    this.#token = token;

    return Promise.resolve();
  }

  /**
   * Drops the token held in memory.
   */
  clear(): Promise<void> {
    this.#token = null;

    return Promise.resolve();
  }
}

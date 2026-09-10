import type { Token } from './token.js';

/**
 * Pluggable persistence for the bearer token.
 *
 * The default is {@link InMemoryTokenStore}, which caches the token for the life
 * of the process. That is the right choice for a long-lived server. It is the
 * wrong choice when every request runs in a fresh process or isolate - a
 * serverless function, for instance - because each one would then perform its own
 * credential exchange. {@link FileTokenStore} covers the single-machine case, and
 * this interface covers everything else.
 *
 * Every method is asynchronous so a store can talk to a remote system:
 *
 * ```ts
 * class RedisTokenStore implements TokenStore {
 *   constructor(private readonly redis: MyRedisClient) {}
 *
 *   async get(): Promise<Token | null> {
 *     const raw = await this.redis.get('astermd:token');
 *     if (raw === null) return null;
 *     const { value, expiresAt } = JSON.parse(raw);
 *     return new Token(value, new Date(expiresAt));
 *   }
 *
 *   async put(token: Token): Promise<void> {
 *     await this.redis.set(
 *       'astermd:token',
 *       JSON.stringify({ value: token.value(), expiresAt: token.expiresAt() }),
 *     );
 *   }
 *
 *   async clear(): Promise<void> {
 *     await this.redis.del('astermd:token');
 *   }
 * }
 * ```
 *
 * A stored token is a live credential. Whatever backs the store must be as
 * protected as the client secret itself.
 */
export interface TokenStore {
  /**
   * Returns the cached token, or `null` when there is none.
   *
   * Expiry is not this method's concern - {@link TokenManager} checks it. A store
   * should return whatever it holds and treat unreadable or corrupt state as
   * absence rather than raising.
   *
   * @returns The stored token, or `null`.
   */
  get(): Promise<Token | null>;

  /**
   * Stores a freshly acquired token, replacing any previous one.
   *
   * @param token The token to persist.
   */
  put(token: Token): Promise<void>;

  /**
   * Discards the stored token so the next {@link TokenStore.get} returns `null`.
   *
   * Called when the server rejects the current token, before a fresh one is
   * acquired.
   */
  clear(): Promise<void>;
}

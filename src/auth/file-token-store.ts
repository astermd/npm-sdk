import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Token } from './token.js';
import type { TokenStore } from './token-store.js';

/**
 * File-backed {@link TokenStore} that persists the JWT across processes.
 *
 * Unlike {@link InMemoryTokenStore}, this writes the token as JSON to disk so it
 * survives a process boundary. That makes it the right choice where each request
 * or invocation gets a fresh process and an in-memory cache would never be hit,
 * as long as those processes share a filesystem.
 *
 * ```ts
 * const client = new AsterMDClient({
 *   clientId: process.env.ASTERMD_CLIENT_ID!,
 *   clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
 *   tokenStore: new FileTokenStore('/var/cache/astermd/token.json'),
 * });
 * ```
 *
 * The parent directory is created if absent. The file is written `0o600` - owner
 * read and write only - so the token is not world-readable on a shared host. It
 * must be writable by the service account and should sit outside any document
 * root. One file per set of API credentials is enough.
 *
 * Writes are atomic: the content goes to a uniquely named temporary file in the
 * same directory and is then renamed over the target, so a concurrent reader
 * sees either the whole previous token or the whole new one. Both reads and
 * writes treat any failure - missing file, bad permissions, a read-only cache
 * directory, truncated or corrupt JSON - as "no token" rather than raising,
 * which makes a damaged cache cost one extra credential exchange instead of
 * breaking the request it was only meant to optimise.
 */
export class FileTokenStore implements TokenStore {
  readonly #path: string;

  /**
   * @param path Path to the JSON file used for token storage. The parent
   *   directory is created on first write if it does not exist.
   */
  constructor(path: string) {
    this.#path = path;
  }

  /**
   * Reads the cached token from the file.
   *
   * @returns The stored token, or `null` when the file is absent, unreadable, or
   *   does not hold a usable token.
   */
  async get(): Promise<Token | null> {
    let contents: string;

    try {
      contents = await readFile(this.#path, 'utf8');
    } catch {
      return null;
    }

    if (contents === '') {
      return null;
    }

    let decoded: unknown;

    try {
      decoded = JSON.parse(contents);
    } catch {
      return null;
    }

    if (typeof decoded !== 'object' || decoded === null) {
      return null;
    }

    const { value, expires_at: expiresAt } = decoded as Record<string, unknown>;

    if (typeof value !== 'string' || typeof expiresAt !== 'string') {
      return null;
    }

    const parsed = new Date(expiresAt);

    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return new Token(value, parsed);
  }

  /**
   * Writes the token to the backing file, replacing any existing content.
   *
   * Persistence is best-effort: a filesystem failure - a read-only or
   * misconfigured cache directory, a permissions problem - is swallowed rather
   * than thrown, matching the PHP SDK's `put()`, which returns early on a
   * `fopen` failure. This method runs on every token acquisition, so failing it
   * would fail the API call it was only meant to optimise; the cost of a
   * degraded cache is an extra credential exchange next time, not a broken
   * request.
   *
   * @param token The freshly acquired token to persist.
   */
  async put(token: Token): Promise<void> {
    const directory = dirname(this.#path);

    // Write then rename: rename is atomic, so a concurrent reader never observes
    // a partially written file. Node has no portable equivalent of PHP's flock.
    const temporary = join(directory, `.${randomUUID()}.tmp`);

    try {
      await mkdir(directory, { recursive: true, mode: 0o755 });

      const contents = JSON.stringify({
        value: token.value(),
        expires_at: token.expiresAt().toISOString(),
      });

      await writeFile(temporary, contents, { mode: 0o600 });
      await rename(temporary, this.#path);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Deletes the backing file so the next {@link FileTokenStore.get} returns
   * `null`.
   *
   * A no-op when the file does not exist, including when another process
   * removed it first. Best-effort otherwise: any other filesystem failure (for
   * example a permissions problem) is swallowed rather than thrown, since a
   * cache that fails to clear only costs a stale-token read on the next call,
   * which {@link FileTokenStore.get} already tolerates.
   */
  async clear(): Promise<void> {
    await rm(this.#path, { force: true }).catch(() => undefined);
  }
}

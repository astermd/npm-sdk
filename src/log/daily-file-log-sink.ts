import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

/** Options accepted by {@link DailyFileLogSink}. */
export interface DailyFileLogSinkOptions {
  /**
   * Undated path the daily filenames are derived from, e.g.
   * `/var/log/astermd/sdk.log`. A path with no extension gets `.log`.
   */
  basePath: string;
  /**
   * Days of logs to keep. A file is removed once its date is more than this many
   * days before today. Use `0` to keep every file forever. Defaults to 7.
   */
  retentionDays?: number;
  /**
   * IANA time zone deciding which calendar day an entry belongs to. Pass the same
   * zone used for log timestamps so filenames and their contents agree. Defaults
   * to `UTC`.
   */
  timeZone?: string;
}

/**
 * Debug-log sink that writes one file per calendar day and prunes old files.
 *
 * The debug logger emits one entry per HTTP request. Appending those to a single
 * file grows without bound, which is why this sink dates each file and deletes
 * the ones that have aged out - the same arrangement as conventional daily log
 * rotation, but self-contained, so no external rotation tooling is needed.
 *
 * You give it a *base path* and it derives dated filenames from it, keeping the
 * directory, stem, and extension you chose:
 *
 * ```
 * basePath: /var/log/astermd/sdk.log
 *
 * /var/log/astermd/sdk-2026-09-08.log   ← today, appended to
 * /var/log/astermd/sdk-2026-09-07.log
 * /var/log/astermd/sdk-2026-09-01.log   ← deleted once it is over 7 days old
 * ```
 *
 * {@link AsterMDClient} builds one for you when you pass `debugFile`; construct
 * it directly only if you want to reuse one sink across several clients.
 *
 * Pruning reads the date out of each filename rather than the filesystem's
 * modification time, so a file that was merely touched is still removed on
 * schedule and unrelated files sharing the directory are never matched. It runs
 * at most once per instance, on the first write, which keeps it off the hot path.
 *
 * Writes are serialized through an internal promise chain, so concurrent requests
 * cannot interleave halves of two entries. Every I/O failure is swallowed: losing
 * a debug entry is never worth failing the request that produced it.
 *
 * Supplying your own `debugSink` bypasses this class entirely, and retention then
 * becomes that system's responsibility.
 */
export class DailyFileLogSink {
  readonly #directory: string;
  readonly #stem: string;
  readonly #extension: string;
  readonly #retentionDays: number;
  readonly #dateFormatter: Intl.DateTimeFormat;

  #pruned = false;
  #tail: Promise<void> = Promise.resolve();

  /**
   * @param options Base path, retention window, and time zone.
   * @throws {TypeError} If `basePath` is empty or carries no file name, or if
   *   `retentionDays` is negative.
   */
  constructor(options: DailyFileLogSinkOptions) {
    const { basePath, retentionDays = 7, timeZone = 'UTC' } = options;

    if (basePath.trim() === '') {
      throw new TypeError('basePath must be a non-empty file path.');
    }

    if (retentionDays < 0) {
      throw new TypeError('retentionDays must be >= 0 (0 disables pruning).');
    }

    const extension = extname(basePath);
    const stem = basename(basePath, extension);

    if (stem === '') {
      throw new TypeError(`basePath must include a file name. Got: ${basePath}`);
    }

    this.#directory = dirname(basePath);
    this.#stem = stem;
    this.#extension = extension === '' ? '.log' : extension;
    this.#retentionDays = retentionDays;
    this.#dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  /**
   * Appends one entry to today's log file, pruning aged-out files on the first
   * call.
   *
   * Resolves once the entry is on disk. Writes are chained, so entries land whole
   * and in call order even under concurrency. Never rejects: an I/O failure is
   * swallowed rather than propagated into the API call being logged.
   *
   * @param entry The formatted log entry to append.
   */
  async write(entry: string): Promise<void> {
    this.#tail = this.#tail.then(() => this.#append(entry)).catch(() => undefined);

    await this.#tail;
  }

  /**
   * Returns the absolute path entries are currently written to.
   *
   * Useful in tests and for a "where are my logs" diagnostic. The path changes at
   * midnight in the configured time zone.
   *
   * @returns The dated file path, e.g. `/var/log/astermd/sdk-2026-09-08.log`.
   */
  currentFile(): string {
    return join(this.#directory, `${this.#stem}-${this.#today()}${this.#extension}`);
  }

  async #append(entry: string): Promise<void> {
    try {
      // Owner-only: with debugRedact: false a raw entry can carry a live
      // bearer token, so the directory and file must not be readable by every
      // user on the host, the same rule FileTokenStore already follows.
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      await appendFile(this.currentFile(), entry, { mode: 0o600 });

      if (!this.#pruned) {
        this.#pruned = true;
        await this.#prune();
      }
    } catch {
      // Losing a debug entry is never worth failing the request that produced it.
    }
  }

  /**
   * Deletes dated log files older than the retention window.
   *
   * Only files matching this sink's own `{stem}-YYYY-MM-DD{ext}` pattern are
   * considered, and the date comes from the filename rather than filesystem
   * metadata. A file that cannot be deleted is skipped silently.
   */
  async #prune(): Promise<void> {
    if (this.#retentionDays === 0) {
      return;
    }

    const cutoff = this.#cutoff();
    const pattern = new RegExp(`^${escapeRegExp(this.#stem)}-(\\d{4}-\\d{2}-\\d{2})${escapeRegExp(this.#extension)}$`);

    let names: string[];

    try {
      names = await readdir(this.#directory);
    } catch {
      return;
    }

    for (const name of names) {
      const matched = pattern.exec(name);

      // ISO dates sort lexicographically, so a string comparison is a date
      // comparison. A file exactly `retentionDays` old is kept, matching PHP.
      if (matched !== null && matched[1]! < cutoff) {
        try {
          await rm(join(this.#directory, name), { force: true });
        } catch {
          // A file we cannot delete is not worth failing over; PHP's @unlink
          // skips silently too. Try the next one.
        }
      }
    }
  }

  #today(): string {
    return this.#dateFormatter.format(new Date());
  }

  /** The oldest date still kept, as `YYYY-MM-DD`. */
  #cutoff(): string {
    const today = new Date(`${this.#today()}T00:00:00.000Z`);
    today.setUTCDate(today.getUTCDate() - this.#retentionDays);

    return today.toISOString().slice(0, 10);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

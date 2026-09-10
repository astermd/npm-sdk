import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FileTokenStore } from '../../src/auth/file-token-store.js';
import { Token } from '../../src/auth/token.js';

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'astermd-token-'));
  path = join(dir, 'token.json');
});

describe('FileTokenStore', () => {
  it('returns null when the file does not exist', async () => {
    expect(await new FileTokenStore(path).get()).toBeNull();
  });

  it('round-trips a token through the file', async () => {
    const store = new FileTokenStore(path);
    const token = new Token('fake-jwt-value', new Date('2026-09-08T12:00:00.000Z'));

    await store.put(token);
    const loaded = await store.get();

    expect(loaded).not.toBeNull();
    expect(loaded!.value()).toBe('fake-jwt-value');
    expect(loaded!.expiresAt().toISOString()).toBe('2026-09-08T12:00:00.000Z');
  });

  it('writes the file owner-readable only', async () => {
    await new FileTokenStore(path).put(new Token('t', new Date('2026-09-08T12:00:00.000Z')));

    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('creates the parent directory when it is missing', async () => {
    const nested = join(dir, 'a', 'b', 'token.json');

    await new FileTokenStore(nested).put(new Token('t', new Date('2026-09-08T12:00:00.000Z')));

    expect((await new FileTokenStore(nested).get())!.value()).toBe('t');
  });

  it('stores an ISO-8601 expiry, readable by anything that parses ISO dates', async () => {
    await new FileTokenStore(path).put(new Token('fake-jwt-value', new Date('2026-09-08T12:00:00.000Z')));

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      value: 'fake-jwt-value',
      expires_at: '2026-09-08T12:00:00.000Z',
    });
  });

  it('replaces a previous token rather than appending', async () => {
    const store = new FileTokenStore(path);

    await store.put(new Token('first', new Date('2026-09-08T12:00:00.000Z')));
    await store.put(new Token('second', new Date('2026-09-08T13:00:00.000Z')));

    expect((await store.get())!.value()).toBe('second');
  });

  it('removes the file on clear and tolerates a repeat clear', async () => {
    const store = new FileTokenStore(path);
    await store.put(new Token('t', new Date('2026-09-08T12:00:00.000Z')));

    await store.clear();
    await store.clear();

    expect(await store.get()).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['not JSON', 'nonsense'],
    ['JSON but not an object', '"a string"'],
    ['missing value', '{"expires_at":"2026-09-08T12:00:00.000Z"}'],
    ['missing expires_at', '{"value":"t"}'],
    ['a non-string value', '{"value":1,"expires_at":"2026-09-08T12:00:00.000Z"}'],
    ['an unparseable expires_at', '{"value":"t","expires_at":"not a date"}'],
  ])('treats a file that is %s as no token', async (_label, contents) => {
    await writeFile(path, contents, { mode: 0o600 });

    expect(await new FileTokenStore(path).get()).toBeNull();
  });

  it('treats an unreadable file as no token rather than raising', async () => {
    await writeFile(path, '{"value":"t","expires_at":"2026-09-08T12:00:00.000Z"}', { mode: 0o600 });
    await chmod(path, 0o000);

    expect(await new FileTokenStore(path).get()).toBeNull();

    await chmod(path, 0o600);
  });

  it('leaves no temporary files behind', async () => {
    const { readdir } = await import('node:fs/promises');
    await new FileTokenStore(path).put(new Token('t', new Date('2026-09-08T12:00:00.000Z')));

    expect(await readdir(dir)).toEqual(['token.json']);
  });

  it('resolves rather than throwing when the cache directory is not writable', async () => {
    // A privileged test process ignores directory mode bits entirely, so this
    // guard would otherwise be a false pass (or fail for the wrong reason).
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return;
    }

    const readOnlyDir = join(dir, 'ro');
    const target = join(readOnlyDir, 'token.json');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(readOnlyDir);
    await chmod(readOnlyDir, 0o500);

    try {
      await expect(
        new FileTokenStore(target).put(new Token('t', new Date('2026-09-08T12:00:00.000Z'))),
      ).resolves.toBeUndefined();

      expect(await new FileTokenStore(target).get()).toBeNull();
    } finally {
      await chmod(readOnlyDir, 0o700);
    }
  });

  it('resolves rather than throwing when clear cannot remove the file', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return;
    }

    const readOnlyDir = join(dir, 'ro-clear');
    const target = join(readOnlyDir, 'token.json');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(readOnlyDir);
    await writeFile(target, '{"value":"t","expires_at":"2026-09-08T12:00:00.000Z"}', {
      mode: 0o600,
    });
    await chmod(readOnlyDir, 0o500);

    try {
      await expect(new FileTokenStore(target).clear()).resolves.toBeUndefined();
    } finally {
      await chmod(readOnlyDir, 0o700);
    }
  });
});

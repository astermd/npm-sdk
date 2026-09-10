import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyFileLogSink } from '../../src/log/daily-file-log-sink.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'astermd-log-'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DailyFileLogSink naming', () => {
  it('derives a dated filename from the base path, keeping the stem and extension', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:00:00.000Z'));

    const sink = new DailyFileLogSink({ basePath: join(dir, 'sdk.log') });

    expect(sink.currentFile()).toBe(join(dir, 'sdk-2026-09-08.log'));
  });

  it('defaults the extension to .log when the base path has none', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:00:00.000Z'));

    const sink = new DailyFileLogSink({ basePath: join(dir, 'sdk') });

    expect(sink.currentFile()).toBe(join(dir, 'sdk-2026-09-08.log'));
  });

  it('picks the calendar day of the configured time zone', () => {
    vi.useFakeTimers();
    // 22:30 in New York on the 8th is already the 9th in UTC.
    vi.setSystemTime(new Date('2026-09-09T02:30:00.000Z'));

    const utc = new DailyFileLogSink({ basePath: join(dir, 'sdk.log') });
    const newYork = new DailyFileLogSink({
      basePath: join(dir, 'sdk.log'),
      timeZone: 'America/New_York',
    });

    expect(utc.currentFile()).toBe(join(dir, 'sdk-2026-09-09.log'));
    expect(newYork.currentFile()).toBe(join(dir, 'sdk-2026-09-08.log'));
  });

  it.each([
    ['an empty base path', ''],
    ['a whitespace-only base path', '   '],
    ['a base path with no file name', '/'],
  ])('rejects %s', (_label, basePath) => {
    expect(() => new DailyFileLogSink({ basePath })).toThrow(TypeError);
  });

  it('rejects a negative retention', () => {
    expect(() => new DailyFileLogSink({ basePath: join(dir, 'sdk.log'), retentionDays: -1 })).toThrow(TypeError);
  });
});

describe('DailyFileLogSink writing', () => {
  it('appends entries to today file', async () => {
    const sink = new DailyFileLogSink({ basePath: join(dir, 'sdk.log') });

    await sink.write('first\n');
    await sink.write('second\n');

    expect(await readFile(sink.currentFile(), 'utf8')).toBe('first\nsecond\n');
  });

  it('creates the directory when it does not exist', async () => {
    const sink = new DailyFileLogSink({ basePath: join(dir, 'nested', 'deep', 'sdk.log') });

    await sink.write('entry\n');

    expect(await readFile(sink.currentFile(), 'utf8')).toBe('entry\n');
  });

  it('keeps concurrent entries whole and in order', async () => {
    const sink = new DailyFileLogSink({ basePath: join(dir, 'sdk.log') });
    const entries = Array.from({ length: 40 }, (_unused, index) => `entry-${index}\n`);

    await Promise.all(entries.map(entry => sink.write(entry)));

    expect(await readFile(sink.currentFile(), 'utf8')).toBe(entries.join(''));
  });

  it('does not throw when the path cannot be written', async () => {
    const sink = new DailyFileLogSink({ basePath: join(dir, 'sdk.log') });
    // A directory where the log file should be makes every write fail.
    const { mkdir } = await import('node:fs/promises');
    await mkdir(sink.currentFile());

    await expect(sink.write('entry\n')).resolves.toBeUndefined();
  });

  it('writes the log file and its directory owner-only', async () => {
    const { stat } = await import('node:fs/promises');
    const basePath = join(dir, 'nested', 'sdk.log');
    const sink = new DailyFileLogSink({ basePath });

    await sink.write('entry\n');

    expect((await stat(sink.currentFile())).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'nested'))).mode & 0o777).toBe(0o700);
  });
});

describe('DailyFileLogSink retention', () => {
  it('deletes dated files older than the retention window and keeps the rest', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:00:00.000Z'));

    await writeFile(join(dir, 'sdk-2026-09-07.log'), 'yesterday');
    await writeFile(join(dir, 'sdk-2026-09-01.log'), 'exactly seven days old');
    await writeFile(join(dir, 'sdk-2026-08-31.log'), 'eight days old');

    await new DailyFileLogSink({ basePath: join(dir, 'sdk.log'), retentionDays: 7 }).write('today\n');

    const remaining = (await readdir(dir)).sort();
    expect(remaining).toEqual(['sdk-2026-09-01.log', 'sdk-2026-09-07.log', 'sdk-2026-09-08.log']);
  });

  it('never deletes files that do not match its own pattern', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:00:00.000Z'));

    await writeFile(join(dir, 'sdk-2020-01-01.log'), 'ancient but ours');
    await writeFile(join(dir, 'other-2020-01-01.log'), 'another stem');
    await writeFile(join(dir, 'sdk-2020-01-01.txt'), 'another extension');
    await writeFile(join(dir, 'sdk-not-a-date.log'), 'no date');
    await writeFile(join(dir, 'important.log'), 'unrelated');

    await new DailyFileLogSink({ basePath: join(dir, 'sdk.log'), retentionDays: 7 }).write('today\n');

    const remaining = (await readdir(dir)).sort();
    expect(remaining).toEqual([
      'important.log',
      'other-2020-01-01.log',
      'sdk-2020-01-01.txt',
      'sdk-2026-09-08.log',
      'sdk-not-a-date.log',
    ]);
  });

  it('keeps everything when retention is zero', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:00:00.000Z'));

    await writeFile(join(dir, 'sdk-2019-01-01.log'), 'very old');

    await new DailyFileLogSink({ basePath: join(dir, 'sdk.log'), retentionDays: 0 }).write('today\n');

    expect((await readdir(dir)).sort()).toEqual(['sdk-2019-01-01.log', 'sdk-2026-09-08.log']);
  });

  it('prunes once per instance, not on every write', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:00:00.000Z'));

    const sink = new DailyFileLogSink({ basePath: join(dir, 'sdk.log'), retentionDays: 7 });
    await sink.write('one\n');

    // Reappears after the single prune has already run.
    await writeFile(join(dir, 'sdk-2020-01-01.log'), 'recreated');
    await sink.write('two\n');

    expect((await readdir(dir)).sort()).toEqual(['sdk-2020-01-01.log', 'sdk-2026-09-08.log']);
  });

  it('keeps writing after a file it cannot prune', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:00:00.000Z'));

    // A directory named like an aged-out log file cannot be removed by
    // rm(..., { force: true }), so pruning it throws.
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, 'sdk-2020-01-01.log'));

    const sink = new DailyFileLogSink({ basePath: join(dir, 'sdk.log'), retentionDays: 7 });

    await expect(sink.write('first\n')).resolves.toBeUndefined();
    await expect(sink.write('second\n')).resolves.toBeUndefined();

    expect(await readFile(sink.currentFile(), 'utf8')).toBe('first\nsecond\n');
  });
});

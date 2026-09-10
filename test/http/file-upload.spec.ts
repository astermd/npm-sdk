import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FileUpload } from '../../src/http/file-upload.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'astermd-upload-'));
});

describe('FileUpload.fromContents', () => {
  it('carries the bytes, name, size and derived MIME type', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const upload = FileUpload.fromContents(bytes, 'id-front.jpg');

    expect(upload.contents()).toEqual(bytes);
    expect(upload.fileName()).toBe('id-front.jpg');
    expect(upload.mimeType()).toBe('image/jpeg');
    expect(upload.size()).toBe(4);
  });

  it('honours an explicit MIME type over the extension', () => {
    const upload = FileUpload.fromContents(new Uint8Array([0]), 'blob.jpg', {
      mimeType: 'application/octet-stream',
    });

    expect(upload.mimeType()).toBe('application/octet-stream');
  });

  it.each([
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
    ['gif', 'image/gif'],
    ['pdf', 'application/pdf'],
    ['doc', 'application/msword'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['txt', 'text/plain'],
    ['mp4', 'video/mp4'],
    ['mov', 'video/quicktime'],
    ['webm', 'video/webm'],
  ])('maps .%s to %s', (extension, expected) => {
    expect(FileUpload.fromContents(new Uint8Array([0]), `f.${extension}`).mimeType()).toBe(expected);
  });

  it('is case-insensitive about the extension', () => {
    expect(FileUpload.fromContents(new Uint8Array([0]), 'SCAN.PNG').mimeType()).toBe('image/png');
  });

  it('falls back to application/octet-stream for an unknown extension', () => {
    expect(FileUpload.fromContents(new Uint8Array([0]), 'f.xyz').mimeType()).toBe('application/octet-stream');
    expect(FileUpload.fromContents(new Uint8Array([0]), 'noextension').mimeType()).toBe('application/octet-stream');
  });

  it('strips directory components from the file name', () => {
    expect(FileUpload.fromContents(new Uint8Array([0]), '/etc/passwd').fileName()).toBe('passwd');
    expect(FileUpload.fromContents(new Uint8Array([0]), '../../secrets/key.txt').fileName()).toBe('key.txt');
  });

  it('strips characters that could forge a Content-Disposition header', () => {
    expect(FileUpload.fromContents(new Uint8Array([0]), 'a"b\r\nContent-Type: evil\\c.jpg').fileName()).toBe(
      'abContent-Type: evilc.jpg',
    );
  });

  it.each([[''], ['   '], ['.'], ['..'], ['/']])('rejects the unusable file name %o', name => {
    expect(() => FileUpload.fromContents(new Uint8Array([0]), name)).toThrow(TypeError);
  });
});

describe('FileUpload.fromPath', () => {
  it('reads the bytes and derives the name and MIME type from the path', async () => {
    const path = join(dir, 'scan.png');
    await writeFile(path, Buffer.from([9, 8, 7]));

    const upload = await FileUpload.fromPath(path);

    expect(Array.from(upload.contents())).toEqual([9, 8, 7]);
    expect(upload.fileName()).toBe('scan.png');
    expect(upload.mimeType()).toBe('image/png');
    expect(upload.size()).toBe(3);
  });

  it('accepts an overriding name and MIME type', async () => {
    const path = join(dir, 'raw.bin');
    await writeFile(path, Buffer.from([1]));

    const upload = await FileUpload.fromPath(path, {
      fileName: 'consult.mp4',
      mimeType: 'video/mp4',
    });

    expect(upload.fileName()).toBe('consult.mp4');
    expect(upload.mimeType()).toBe('video/mp4');
  });

  it('rejects a path that is not a readable file', async () => {
    await expect(FileUpload.fromPath(join(dir, 'missing.jpg'))).rejects.toThrow(TypeError);
    await expect(FileUpload.fromPath(join(dir, 'missing.jpg'))).rejects.toThrow(/File is not readable/);
  });

  it('rejects a directory', async () => {
    await expect(FileUpload.fromPath(dir)).rejects.toThrow(/File is not readable/);
  });
});

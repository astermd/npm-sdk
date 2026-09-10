import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/errors/index.js';
import { FileUpload } from '../../src/http/file-upload.js';
import { IntakeSubmissions } from '../../src/resource/intake-submissions.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'astermd-large-'));
});

const MB = 1024 * 1024;

describe('IntakeSubmissions.uploadFile', () => {
  it('posts the file as multipart to upload-file/{session_id}', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(201, OK_ENVELOPE);

    await new IntakeSubmissions(transport).uploadFile({
      sessionId: 's-1',
      file: FileUpload.fromContents(new Uint8Array([1, 2, 3]), 'id-front.jpg'),
    });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/intake-submissions/upload-file/s-1');
    expect(request.method).toBe('POST');
    expect(request.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);

    const part = request.formData!.get('file') as File;
    expect(part.name).toBe('id-front.jpg');
    expect(part.type).toBe('image/jpeg');
  });
});

describe('IntakeSubmissions.initiateMultipartUpload', () => {
  it('posts the file metadata to the initiate endpoint', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, { data: { upload_id: 'u-1' } });

    await new IntakeSubmissions(transport).initiateMultipartUpload({
      sessionId: 's-1',
      fileName: 'consult.mp4',
      mimeType: 'video/mp4',
      fileSize: 26_214_400,
    });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/intake-submissions/upload-file-multipart/initiate/s-1');
    expect(JSON.parse(request.body)).toEqual({
      file_name: 'consult.mp4',
      mime_type: 'video/mp4',
      file_size: 26_214_400,
    });
  });
});

describe('IntakeSubmissions.uploadMultipartPart', () => {
  it('posts the part with its number as a query parameter', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, { data: { etag: 'etag-1' } });

    await new IntakeSubmissions(transport).uploadMultipartPart({
      uploadId: 'u-1',
      partNumber: 3,
      part: FileUpload.fromContents(new Uint8Array([9]), 'consult.mp4'),
    });

    const request = http.lastRequest();
    expect(request.url).toBe(
      'https://api.astermd.com/v1/sales/intake-submissions/upload-file-multipart/part/u-1?part_number=3',
    );
    expect(request.formData!.get('file')).toBeInstanceOf(File);
  });

  it.each([[0], [-1], [10_001]])('rejects part number %i', async partNumber => {
    const { transport } = makeHarness();

    await expect(
      new IntakeSubmissions(transport).uploadMultipartPart({
        uploadId: 'u-1',
        partNumber,
        part: FileUpload.fromContents(new Uint8Array([0]), 'f.mp4'),
      }),
    ).rejects.toThrow(TypeError);
  });

  it.each([[1], [10_000]])('accepts boundary part number %i', async partNumber => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, { data: { etag: 'e' } });

    await expect(
      new IntakeSubmissions(transport).uploadMultipartPart({
        uploadId: 'u-1',
        partNumber,
        part: FileUpload.fromContents(new Uint8Array([0]), 'f.mp4'),
      }),
    ).resolves.toBeDefined();
  });
});

describe('IntakeSubmissions.finishMultipartUpload', () => {
  it('posts the collected part etags', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    const parts = [
      { part_number: 1, etag: 'etag-1' },
      { part_number: 2, etag: 'etag-2' },
    ];

    await new IntakeSubmissions(transport).finishMultipartUpload({
      uploadId: 'u-1',
      parts,
    });

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/intake-submissions/upload-file-multipart/finish/u-1');
    expect(JSON.parse(request.body)).toEqual({ parts });
  });

  it('refuses to finish with no parts', async () => {
    const { transport } = makeHarness();

    await expect(
      new IntakeSubmissions(transport).finishMultipartUpload({
        uploadId: 'u-1',
        parts: [],
      }),
    ).rejects.toThrow(TypeError);
  });
});

describe('IntakeSubmissions.abortMultipartUpload', () => {
  it('posts to the abort endpoint with no body', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new IntakeSubmissions(transport).abortMultipartUpload('u-1');

    const request = http.lastRequest();
    expect(request.url).toBe('https://api.astermd.com/v1/sales/intake-submissions/upload-file-multipart/abort/u-1');
    expect(request.method).toBe('POST');
    expect(request.body).toBe('');
  });
});

describe('IntakeSubmissions.uploadLargeFile', () => {
  it('drives initiate, one part per chunk, then finish', async () => {
    const path = join(dir, 'consult.mp4');
    await writeFile(path, Buffer.alloc(10 * MB, 7));

    const { transport, http } = makeHarness();
    http.enqueueJson(200, { data: { upload_id: 'u-1' } });
    http.enqueueJson(200, { data: { etag: 'etag-1' } });
    http.enqueueJson(200, { data: { etag: 'etag-2' } });
    http.enqueueJson(200, {
      success: true,
      data: { file_url: 'stored/consult.mp4' },
    });

    const response = await new IntakeSubmissions(transport).uploadLargeFile({
      sessionId: 's-1',
      filePath: path,
      partSize: 5 * MB,
    });

    expect(http.requests).toHaveLength(4);

    expect(JSON.parse(http.requests[0]!.body)).toEqual({
      file_name: 'consult.mp4',
      mime_type: 'video/mp4',
      file_size: 10 * MB,
    });

    expect(http.requests[1]!.url).toContain('part/u-1?part_number=1');
    expect(http.requests[2]!.url).toContain('part/u-1?part_number=2');

    expect(JSON.parse(http.requests[3]!.body)).toEqual({
      parts: [
        { part_number: 1, etag: 'etag-1' },
        { part_number: 2, etag: 'etag-2' },
      ],
    });
    expect(response.data()).toEqual({ file_url: 'stored/consult.mp4' });
  });

  it('sends a third part for the remainder when the file is not a multiple of the part size', async () => {
    const path = join(dir, 'consult.mp4');
    await writeFile(path, Buffer.alloc(11 * MB, 1));

    const { transport, http } = makeHarness();
    http.enqueueJson(200, { data: { upload_id: 'u-1' } });
    http.enqueueJson(200, { data: { etag: 'e1' } });
    http.enqueueJson(200, { data: { etag: 'e2' } });
    http.enqueueJson(200, { data: { etag: 'e3' } });
    http.enqueueJson(200, OK_ENVELOPE);

    await new IntakeSubmissions(transport).uploadLargeFile({
      sessionId: 's-1',
      filePath: path,
      partSize: 5 * MB,
    });

    expect(http.requests).toHaveLength(5);
    const lastPart = http.requests[3]!.formData!.get('file') as File;
    expect(lastPart.size).toBe(1 * MB);
  });

  it('sends each part the bytes of its own region of the file', async () => {
    const path = join(dir, 'consult.mp4');
    // Distinct bytes per region, so this asserts payload integrity rather than
    // only part counts, sizes and etags. Note it does not detect aliasing of the
    // reused read buffer: Transport's Blob snapshot happens before the next read,
    // which hides that - see the copy in uploadLargeFile for why it is still kept.
    await writeFile(
      path,
      Buffer.concat([Buffer.alloc(5 * MB, 0xaa), Buffer.alloc(5 * MB, 0xbb), Buffer.alloc(1 * MB, 0xcc)]),
    );

    const { transport, http } = makeHarness();
    http.enqueueJson(200, { data: { upload_id: 'u-1' } });
    http.enqueueJson(200, { data: { etag: 'e1' } });
    http.enqueueJson(200, { data: { etag: 'e2' } });
    http.enqueueJson(200, { data: { etag: 'e3' } });
    http.enqueueJson(200, OK_ENVELOPE);

    await new IntakeSubmissions(transport).uploadLargeFile({
      sessionId: 's-1',
      filePath: path,
      partSize: 5 * MB,
    });

    const expected = [
      { size: 5 * MB, fill: 0xaa },
      { size: 5 * MB, fill: 0xbb },
      { size: 1 * MB, fill: 0xcc },
    ];

    for (const [index, want] of expected.entries()) {
      // requests[0] is initiate, so the parts start at index 1.
      const part = http.requests[index + 1]!.formData!.get('file') as File;
      const bytes = new Uint8Array(await part.arrayBuffer());

      expect(bytes.byteLength).toBe(want.size);
      // Comparing the set of distinct byte values is cheap and proves the whole
      // part came from its own region rather than from another chunk.
      expect(new Set(bytes)).toEqual(new Set([want.fill]));
    }
  });

  it('honours an overriding name and MIME type across every part', async () => {
    const path = join(dir, 'raw.bin');
    await writeFile(path, Buffer.alloc(6 * MB, 3));

    const { transport, http } = makeHarness();
    http.enqueueJson(200, { data: { upload_id: 'u-1' } });
    http.enqueueJson(200, { data: { etag: 'e1' } });
    http.enqueueJson(200, { data: { etag: 'e2' } });
    http.enqueueJson(200, OK_ENVELOPE);

    await new IntakeSubmissions(transport).uploadLargeFile({
      sessionId: 's-1',
      filePath: path,
      fileName: 'consult.mp4',
      mimeType: 'video/mp4',
      partSize: 5 * MB,
    });

    expect(JSON.parse(http.requests[0]!.body)).toMatchObject({
      file_name: 'consult.mp4',
      mime_type: 'video/mp4',
    });
    for (const index of [1, 2]) {
      const part = http.requests[index]!.formData!.get('file') as File;
      expect(part.name).toBe('consult.mp4');
      expect(part.type).toBe('video/mp4');
    }
  });

  it('aborts the upload and rethrows the original failure when a part fails', async () => {
    const path = join(dir, 'consult.mp4');
    await writeFile(path, Buffer.alloc(6 * MB, 5));

    const { transport, http } = makeHarness();
    http.enqueueJson(200, { data: { upload_id: 'u-1' } });
    http.enqueueJson(200, { data: { etag: 'e1' } });
    http.enqueueJson(500, { message: 'Storage unavailable.' });
    http.enqueueJson(200, OK_ENVELOPE); // the abort

    const failure = new IntakeSubmissions(transport).uploadLargeFile({
      sessionId: 's-1',
      filePath: path,
      partSize: 5 * MB,
    });

    await expect(failure).rejects.toThrow('Storage unavailable.');
    expect(http.lastRequest().url).toContain('abort/u-1');
  });

  it('still reports the original failure when the abort also fails', async () => {
    const path = join(dir, 'consult.mp4');
    await writeFile(path, Buffer.alloc(6 * MB, 5));

    const { transport, http } = makeHarness();
    http.enqueueJson(200, { data: { upload_id: 'u-1' } });
    http.enqueueJson(500, { message: 'Storage unavailable.' });
    http.enqueueJson(500, { message: 'Abort failed too.' });

    await expect(
      new IntakeSubmissions(transport).uploadLargeFile({
        sessionId: 's-1',
        filePath: path,
        partSize: 5 * MB,
      }),
    ).rejects.toThrow('Storage unavailable.');
  });

  it('raises ApiError when initiate returns no usable upload id', async () => {
    const path = join(dir, 'consult.mp4');
    await writeFile(path, Buffer.alloc(6 * MB, 5));

    const { transport, http } = makeHarness();
    http.enqueueJson(200, { data: {} });

    await expect(
      new IntakeSubmissions(transport).uploadLargeFile({
        sessionId: 's-1',
        filePath: path,
        partSize: 5 * MB,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('raises ApiError when a part returns no usable etag', async () => {
    const path = join(dir, 'consult.mp4');
    await writeFile(path, Buffer.alloc(6 * MB, 5));

    const { transport, http } = makeHarness();
    http.enqueueJson(200, { data: { upload_id: 'u-1' } });
    http.enqueueJson(200, { data: { etag: '' } });
    http.enqueueJson(200, OK_ENVELOPE); // the abort

    await expect(
      new IntakeSubmissions(transport).uploadLargeFile({
        sessionId: 's-1',
        filePath: path,
        partSize: 5 * MB,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it.each([
    ['below the minimum', 4 * MB],
    ['above the maximum', 26 * MB],
  ])('rejects a part size %s', async (_label, partSize) => {
    const path = join(dir, 'consult.mp4');
    await writeFile(path, Buffer.alloc(1024, 1));
    const { transport } = makeHarness();

    await expect(
      new IntakeSubmissions(transport).uploadLargeFile({
        sessionId: 's-1',
        filePath: path,
        partSize,
      }),
    ).rejects.toThrow(TypeError);
  });

  it('rejects a missing file', async () => {
    const { transport } = makeHarness();

    await expect(
      new IntakeSubmissions(transport).uploadLargeFile({
        sessionId: 's-1',
        filePath: join(dir, 'missing.mp4'),
      }),
    ).rejects.toThrow(/File is not readable/);
  });

  it('rejects an empty file', async () => {
    const path = join(dir, 'empty.mp4');
    await writeFile(path, Buffer.alloc(0));
    const { transport } = makeHarness();

    await expect(
      new IntakeSubmissions(transport).uploadLargeFile({
        sessionId: 's-1',
        filePath: path,
      }),
    ).rejects.toThrow(/File is empty/);
  });

  it('exposes the part-size bounds as constants', () => {
    expect(IntakeSubmissions.MIN_PART_SIZE).toBe(5 * MB);
    expect(IntakeSubmissions.MAX_PART_SIZE).toBe(25 * MB);
    expect(IntakeSubmissions.DEFAULT_PART_SIZE).toBe(10 * MB);
  });
});

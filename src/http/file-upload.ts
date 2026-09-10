import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

/**
 * Extension-to-MIME map covering the types the file endpoints accept.
 *
 * An explicit table rather than content sniffing, because sniffing misreports
 * some of these: a `.docx` is a ZIP container on disk and sniffs as
 * `application/zip`, which the server rejects.
 */
const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
});

/** MIME type used when the file name does not identify the content. */
const FALLBACK_MIME_TYPE = 'application/octet-stream';

/** Overrides accepted by {@link FileUpload.fromPath}. */
export interface FileUploadFromPathOptions {
  /** Name to send in the part header. Defaults to the path's base name. */
  fileName?: string;
  /** MIME type to send. Defaults to one derived from the extension. */
  mimeType?: string;
}

/** Overrides accepted by {@link FileUpload.fromContents}. */
export interface FileUploadFromContentsOptions {
  /** MIME type to send. Defaults to one derived from the file name. */
  mimeType?: string;
}

/**
 * An immutable file, in memory, ready to be sent as a `multipart/form-data`
 * part.
 *
 * A handful of AsterMD endpoints take bytes rather than JSON - the
 * intake-submission file endpoints on the `sales` service are the current
 * example. Those bytes come from very different places: a file your users just
 * uploaded and that now sits on local disk, or a slice of a large file being fed
 * through the multipart flow one chunk at a time. This class is the single shape
 * resource methods accept for both, so {@link Transport} has exactly one thing
 * to encode.
 *
 * Build it through one of the two factories - the constructor is private, so an
 * instance always carries a file name and a MIME type:
 *
 * ```ts
 * // From a file on disk; name and MIME type come from the path.
 * await client.intakeSubmissions().uploadFile(
 *   sessionId,
 *   await FileUpload.fromPath('/var/uploads/id-front.jpg'),
 * );
 *
 * // From bytes already in memory: one 10 MB slice of a large video.
 * await client.intakeSubmissions().uploadMultipartPart({
 *   uploadId,
 *   partNumber: 1,
 *   part: FileUpload.fromContents(chunk, 'consult-video.mp4'),
 * });
 * ```
 *
 * The whole file is held in memory, so it is deliberately not the right tool for
 * a 200 MB video - use {@link IntakeSubmissions.uploadLargeFile}, which streams
 * from disk and only ever materialises one part at a time.
 *
 * File names are normalised on construction: directory components are dropped
 * and quote, backslash, and newline characters removed, so a caller-supplied
 * name can never break out of the header it is written into.
 */
export class FileUpload {
  readonly #contents: Uint8Array;
  readonly #fileName: string;
  readonly #mimeType: string;

  private constructor(contents: Uint8Array, fileName: string, mimeType: string) {
    this.#contents = contents;
    this.#fileName = fileName;
    this.#mimeType = mimeType;

    Object.freeze(this);
  }

  /**
   * Reads a file from local disk into an upload.
   *
   * The file is read in full and held in memory, so keep this for the sizes the
   * single-shot endpoints allow. Without `options.fileName` the path's base name
   * is used, and without `options.mimeType` the type is derived from the
   * extension, falling back to `application/octet-stream`.
   *
   * @param path Path to an existing, readable file.
   * @param options Optional name and MIME type overrides.
   * @returns An upload carrying the file's bytes, name, and MIME type.
   * @throws {TypeError} If `path` is not a readable file, or if the resulting
   *   file name normalises to nothing usable.
   */
  static async fromPath(path: string, options: FileUploadFromPathOptions = {}): Promise<FileUpload> {
    let isFile = false;

    try {
      isFile = (await stat(path)).isFile();
    } catch {
      isFile = false;
    }

    if (!isFile) {
      throw new TypeError(`File is not readable: ${path}`);
    }

    let contents: Buffer;

    try {
      contents = await readFile(path);
    } catch (error) {
      throw new TypeError(`Failed to read file: ${path}`, { cause: error });
    }

    const name = normaliseFileName(options.fileName ?? basename(path));

    return new FileUpload(new Uint8Array(contents), name, options.mimeType ?? guessMimeType(name));
  }

  /**
   * Wraps bytes already held in memory into an upload.
   *
   * Use this when the bytes never came from a file on disk: a slice of a larger
   * file being sent through the multipart flow, a payload received over the
   * wire, or content generated at runtime. `fileName` is required because there
   * is no path to derive one from.
   *
   * @param contents The raw bytes to send as the part body.
   * @param fileName Name to send in the part header.
   * @param options Optional MIME type override.
   * @returns An upload carrying the given bytes, name, and MIME type.
   * @throws {TypeError} If `fileName` normalises to nothing usable.
   */
  static fromContents(contents: Uint8Array, fileName: string, options: FileUploadFromContentsOptions = {}): FileUpload {
    const name = normaliseFileName(fileName);

    return new FileUpload(contents, name, options.mimeType ?? guessMimeType(name));
  }

  /**
   * Returns the raw bytes that will form the body of the multipart part.
   *
   * @returns The file's contents.
   */
  contents(): Uint8Array {
    return this.#contents;
  }

  /**
   * Returns the normalised file name sent in the part header.
   *
   * The server uses this to derive the stored object name, inserting a unique
   * identifier before the extension so repeat uploads of the same name never
   * collide.
   *
   * @returns The file name, stripped of directory components and
   *   header-breaking characters.
   */
  fileName(): string {
    return this.#fileName;
  }

  /**
   * Returns the MIME type sent for the part.
   *
   * @returns The MIME type, e.g. `image/jpeg`.
   */
  mimeType(): string {
    return this.#mimeType;
  }

  /**
   * Returns the size of the upload in bytes.
   *
   * Useful for checking a file against an endpoint's documented limit before
   * spending a round trip on it, and for the `fileSize` value the multipart
   * initiate call requires.
   *
   * @returns The number of bytes in {@link FileUpload.contents}.
   */
  size(): number {
    return this.#contents.byteLength;
  }
}

/**
 * Drops directory components, then strips the characters that would let a
 * caller-supplied name terminate or forge the part header it is written into.
 *
 * @throws {TypeError} If nothing usable remains.
 */
function normaliseFileName(fileName: string): string {
  const stripped = fileName.trim().replace(/[\r\n"\\]/g, '');
  const name = basename(stripped).trim();

  if (name === '' || name === '.' || name === '..') {
    throw new TypeError('File name must not be empty.');
  }

  return name;
}

function guessMimeType(fileName: string): string {
  const extension = extname(fileName).replace(/^\./, '').toLowerCase();

  return MIME_TYPES[extension] ?? FALLBACK_MIME_TYPE;
}

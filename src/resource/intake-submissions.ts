import { open, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Event } from '../enum/event.js';
import { ApiError } from '../errors/index.js';
import { FileUpload } from '../http/file-upload.js';
import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/** Options for {@link IntakeSubmissions.view}. */
export interface IntakeViewOptions {
  /** The intake submission's id. */
  id: string;
  /** The teleform the submission answers. */
  teleformId: string;
}

/** Options for {@link IntakeSubmissions.create} and {@link IntakeSubmissions.update}. */
export interface IntakeWriteOptions {
  /** The session the submission belongs to. */
  session: string;
  /** The journey event this call records. */
  event: Event;
  /** The teleform being answered. */
  teleformId: string;
  /**
   * The answers, one entry per field: `{ id, name, label, type, value }`, where
   * `value` is itself a list of `{ value }` entries so a multi-select field can
   * carry several. Send every answer collected so far, not only what changed.
   */
  data: Record<string, unknown>[];
  /**
   * Optional progress information for a partially completed form, e.g.
   * `{ current_step, total_steps }`. Lets the server report how far a prospect
   * got before abandoning.
   */
  progress?: Record<string, unknown>;
}

/** Options for {@link IntakeSubmissions.uploadFile}. */
export interface UploadFileOptions {
  /** The session the file belongs to. */
  sessionId: string;
  /** The file to upload. */
  file: FileUpload;
}

/** Options for {@link IntakeSubmissions.initiateMultipartUpload}. */
export interface InitiateMultipartOptions {
  /** The session the file belongs to. */
  sessionId: string;
  /** Name to store the file under. */
  fileName: string;
  /** MIME type of the whole file. */
  mimeType: string;
  /** Total size of the whole file in bytes, not of one part. */
  fileSize: number;
}

/** Options for {@link IntakeSubmissions.uploadMultipartPart}. */
export interface UploadPartOptions {
  /** The upload id returned by initiate. */
  uploadId: string;
  /** 1-based part number, between 1 and 10000. */
  partNumber: number;
  /** The bytes of this part. */
  part: FileUpload;
}

/** One uploaded part, as {@link IntakeSubmissions.finishMultipartUpload} expects it. */
export interface MultipartPart {
  /** The part number that was uploaded. */
  part_number: number;
  /** The etag the server returned for that part. */
  etag: string;
}

/** Options for {@link IntakeSubmissions.finishMultipartUpload}. */
export interface FinishMultipartOptions {
  /** The upload id returned by initiate. */
  uploadId: string;
  /** Every uploaded part with its etag, in order. Must not be empty. */
  parts: MultipartPart[];
}

/** Options for {@link IntakeSubmissions.uploadLargeFile}. */
export interface UploadLargeFileOptions {
  /** The session the file belongs to. */
  sessionId: string;
  /** Path to the file on local disk. */
  filePath: string;
  /** Name to store the file under. Defaults to the path's base name. */
  fileName?: string;
  /** MIME type to send. Defaults to one derived from the file name. */
  mimeType?: string;
  /**
   * Bytes per part. Must be between {@link IntakeSubmissions.MIN_PART_SIZE} and
   * {@link IntakeSubmissions.MAX_PART_SIZE}. Defaults to
   * {@link IntakeSubmissions.DEFAULT_PART_SIZE}.
   */
  partSize?: number;
}

/**
 * Intake submissions - the answers a prospect gives to your questionnaires.
 *
 * This is where the clinical part of the order flow happens. Two questionnaires
 * run through this one resource: the short pre-qualifying form that decides
 * whether a prospect is eligible at all, and the full intake questionnaire a
 * clinician later reviews. Which one a call belongs to is carried entirely by the
 * {@link Event} it passes.
 *
 * Both follow the same rhythm. The `*Initiated` event goes to
 * {@link IntakeSubmissions.create}, which creates the server-side record. Every
 * later step goes to {@link IntakeSubmissions.update} with `*InProgress`, and the
 * final submission with `*Completed`. Sending progress updates as the prospect
 * moves through the form is what makes partial completion visible instead of
 * looking like an abandoned session:
 *
 * ```ts
 * await client.intakeSubmissions().create({
 *   session,
 *   event: Event.IntakeInitiated,
 *   teleformId,
 *   data: answersSoFar,
 * });
 *
 * await client.intakeSubmissions().update({
 *   session,
 *   event: Event.IntakeCompleted,
 *   teleformId,
 *   data: allAnswers,
 * });
 * ```
 *
 * `data` is cumulative: send every answer collected so far on each call, not just
 * the fields that changed. Answers that are files rather than values go through
 * the upload methods on this same resource.
 */
export class IntakeSubmissions extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Fetches one intake submission and its recorded answers.
   *
   * The teleform id is required alongside the submission id because a submission
   * is only meaningful against the form it answers - the server uses it to
   * resolve field definitions for the stored values.
   *
   * @param options The submission id and the teleform it answers.
   * @returns The submission and its answers.
   * @throws {NotFoundError} If the submission does not exist.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async view<T = Record<string, unknown>>(options: IntakeViewOptions): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/intake-submissions/view/{id}',
      pathParams: { id: options.id },
      query: { teleform_id: options.teleformId },
    });
  }

  /**
   * Creates the intake-submission record for a session and records the first
   * answers.
   *
   * This is the call that opens the record, so it takes an `*Initiated` event -
   * `Event.PreQualifyingInitiated` or `Event.IntakeInitiated`. Every later step
   * goes to {@link IntakeSubmissions.update}. The server advances its order-flow
   * state machine on the event, so passing the wrong one puts the flow in the
   * wrong state rather than failing loudly.
   *
   * @param options The session, event, teleform, answers, and optional progress.
   * @returns The created submission.
   * @throws {ValidationError} If the answers or the event are rejected.
   * @throws {NotFoundError} If the session or teleform does not exist.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async create<T = Record<string, unknown>>(options: IntakeWriteOptions): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/intake-submissions/create',
      body: intakeBody(options),
    });
  }

  /**
   * Records further answers against an existing intake submission.
   *
   * Takes an `*InProgress` event for an intermediate step or a `*Completed` event
   * for the final submission. `data` is cumulative - send every answer collected
   * so far, since the server treats the payload as the current state of the form
   * rather than a patch.
   *
   * @param options The session, event, teleform, answers, and optional progress.
   * @returns The updated submission.
   * @throws {ValidationError} If the answers or the event are rejected.
   * @throws {NotFoundError} If no submission exists for the session.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async update<T = Record<string, unknown>>(options: IntakeWriteOptions): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'PUT',
      path: '/intake-submissions/update/{session}',
      pathParams: { session: options.session },
      body: intakeBody(options),
    });
  }

  /** Smallest part the multipart endpoint accepts: 5 MB. */
  static readonly MIN_PART_SIZE = 5 * 1024 * 1024;

  /** Largest part the multipart endpoint accepts: 25 MB. */
  static readonly MAX_PART_SIZE = 25 * 1024 * 1024;

  /** Part size {@link IntakeSubmissions.uploadLargeFile} uses by default: 10 MB. */
  static readonly DEFAULT_PART_SIZE = 10 * 1024 * 1024;

  /**
   * Uploads one file in a single request, for a file-type answer.
   *
   * Use this for the sizes a single request can carry - a photograph of an ID, a
   * PDF. The whole file is held in memory and sent as one `multipart/form-data`
   * body. For anything large enough to risk a timeout, use
   * {@link IntakeSubmissions.uploadLargeFile} instead.
   *
   * The response carries the stored file's reference, which is what you place in
   * the `value` of the corresponding field when you next call
   * {@link IntakeSubmissions.update}.
   *
   * @param options The session and the file.
   * @returns The stored file's reference.
   * @throws {ValidationError} If the file type or size is rejected.
   * @throws {NotFoundError} If the session does not exist.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async uploadFile<T = Record<string, unknown>>(options: UploadFileOptions): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/intake-submissions/upload-file/{session_id}',
      pathParams: { session_id: options.sessionId },
      file: options.file,
    });
  }

  /**
   * Opens a multipart upload and returns the id the parts will be sent under.
   *
   * The first of the four low-level multipart calls. Declare the *whole* file's
   * name, type, and size here - the server uses the size to validate the parts it
   * later receives. Prefer {@link IntakeSubmissions.uploadLargeFile}, which
   * drives all four calls; reach for these directly only when you need to
   * control the loop, for instance to upload parts from several workers.
   *
   * @param options The session and the whole file's metadata.
   * @returns The opened upload; `data().upload_id` carries the id.
   * @throws {ValidationError} If the metadata is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async initiateMultipartUpload<T = Record<string, unknown>>(
    options: InitiateMultipartOptions,
  ): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/intake-submissions/upload-file-multipart/initiate/{session_id}',
      pathParams: { session_id: options.sessionId },
      body: {
        file_name: options.fileName,
        mime_type: options.mimeType,
        file_size: options.fileSize,
      },
    });
  }

  /**
   * Uploads one part of an open multipart upload.
   *
   * Part numbers are 1-based and must arrive with the part they label; the
   * response carries an etag you must keep, because
   * {@link IntakeSubmissions.finishMultipartUpload} needs every part's etag to
   * assemble the file. Parts may be uploaded in any order.
   *
   * @param options The upload id, the part number, and the part's bytes.
   * @returns The stored part; `data().etag` carries the etag.
   * @throws {TypeError} If `partNumber` is outside 1–10000.
   * @throws {NotFoundError} If the upload id is unknown or already finished.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async uploadMultipartPart<T = Record<string, unknown>>(options: UploadPartOptions): Promise<ApiResponse<T>> {
    if (options.partNumber < 1 || options.partNumber > 10_000) {
      throw new TypeError(`Part number must be between 1 and 10000, got ${options.partNumber}.`);
    }

    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/intake-submissions/upload-file-multipart/part/{upload_id}',
      pathParams: { upload_id: options.uploadId },
      query: { part_number: options.partNumber },
      file: options.part,
    });
  }

  /**
   * Closes a multipart upload, assembling the parts into one stored file.
   *
   * Send every part with the etag its own upload returned. The server verifies
   * the set against what it received, so a missing or mismatched part fails here
   * rather than producing a corrupt file.
   *
   * @param options The upload id and every part with its etag.
   * @returns The stored file's reference.
   * @throws {TypeError} If `parts` is empty.
   * @throws {ValidationError} If the parts do not match what the server holds.
   * @throws {NotFoundError} If the upload id is unknown.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async finishMultipartUpload<T = Record<string, unknown>>(options: FinishMultipartOptions): Promise<ApiResponse<T>> {
    if (options.parts.length === 0) {
      throw new TypeError('At least one part is required to finish a multipart upload.');
    }

    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/intake-submissions/upload-file-multipart/finish/{upload_id}',
      pathParams: { upload_id: options.uploadId },
      body: { parts: options.parts },
    });
  }

  /**
   * Abandons a multipart upload and discards the parts already stored.
   *
   * Call this when an upload cannot be completed, so the parts do not linger.
   * {@link IntakeSubmissions.uploadLargeFile} does it for you on failure.
   *
   * @param uploadId The upload id to abandon.
   * @returns The abort confirmation.
   * @throws {NotFoundError} If the upload id is unknown or already finished.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async abortMultipartUpload<T = Record<string, unknown>>(uploadId: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/intake-submissions/upload-file-multipart/abort/{upload_id}',
      pathParams: { upload_id: uploadId },
    });
  }

  /**
   * Uploads a large file from disk, driving the whole multipart flow.
   *
   * This is the method to reach for when a file is too big for one request. It
   * streams the file one part at a time, so a 200 MB video costs one part of
   * memory rather than 200 MB: initiate, then read a part, upload it, keep its
   * etag, repeat, then finish. If any step fails the upload is aborted so no
   * parts are left behind, and the failure that broke the upload is what
   * surfaces - not the abort's own outcome.
   *
   * The first part fixes the name and MIME type for the whole upload, so
   * `initiate` and every part agree.
   *
   * ```ts
   * const stored = await client.intakeSubmissions().uploadLargeFile({
   *   sessionId,
   *   filePath: '/var/uploads/consult-video.mp4',
   * });
   * ```
   *
   * @param options The session, the file's path, and optional name, MIME type,
   *   and part size.
   * @returns The finished upload's response - the same one
   *   {@link IntakeSubmissions.finishMultipartUpload} returns.
   * @throws {TypeError} If `partSize` is outside the allowed range, or if the
   *   file is missing, unreadable, or empty.
   * @throws {ApiError} If the server response omits a usable `upload_id` or
   *   `etag`, or on any other non-2xx status.
   * @throws {TransportError} If a request never completed.
   */
  async uploadLargeFile<T = Record<string, unknown>>(options: UploadLargeFileOptions): Promise<ApiResponse<T>> {
    const partSize = options.partSize ?? IntakeSubmissions.DEFAULT_PART_SIZE;

    if (partSize < IntakeSubmissions.MIN_PART_SIZE || partSize > IntakeSubmissions.MAX_PART_SIZE) {
      throw new TypeError(
        `Part size must be between ${IntakeSubmissions.MIN_PART_SIZE} and ` +
          `${IntakeSubmissions.MAX_PART_SIZE} bytes, got ${partSize}.`,
      );
    }

    let fileSize: number;

    try {
      const stats = await stat(options.filePath);

      if (!stats.isFile()) {
        throw new TypeError(`File is not readable: ${options.filePath}`);
      }

      fileSize = stats.size;
    } catch (error) {
      if (error instanceof TypeError) {
        throw error;
      }

      throw new TypeError(`File is not readable: ${options.filePath}`, {
        cause: error,
      });
    }

    if (fileSize === 0) {
      throw new TypeError(`File is empty: ${options.filePath}`);
    }

    const handle = await open(options.filePath, 'r');

    try {
      const buffer = Buffer.alloc(partSize);
      const firstBytesRead = await readFull(handle, buffer, partSize);

      if (firstBytesRead === 0) {
        throw new TypeError(`File is empty: ${options.filePath}`);
      }

      // The first part fixes the name and MIME type for the whole upload, so
      // initiate agrees with every part that follows it.
      //
      // Copy the chunk out of the reused read buffer. `Buffer.prototype.slice`
      // is an alias for `subarray` and returns a view, not a copy. Today that
      // would still be safe, because Transport snapshots each part into a Blob
      // before the next read refills the buffer - but the copy keeps this
      // correct independently of send ordering, so a later change that reads
      // ahead or batches parts cannot silently ship the wrong bytes.
      let part = FileUpload.fromContents(
        new Uint8Array(buffer.subarray(0, firstBytesRead)),
        options.fileName ?? basename(options.filePath),
        options.mimeType === undefined ? {} : { mimeType: options.mimeType },
      );

      const uploadId = stringField(
        await this.initiateMultipartUpload({
          sessionId: options.sessionId,
          fileName: part.fileName(),
          mimeType: part.mimeType(),
          fileSize,
        }),
        'upload_id',
      );

      try {
        const parts: MultipartPart[] = [];
        let partNumber = 1;

        for (;;) {
          const result = await this.uploadMultipartPart({
            uploadId,
            partNumber,
            part,
          });
          parts.push({
            part_number: partNumber,
            etag: stringField(result, 'etag'),
          });

          const nextBytesRead = await readFull(handle, buffer, partSize);

          if (nextBytesRead === 0) {
            break;
          }

          partNumber += 1;
          // Same reused buffer as above: copy the chunk out for the same reason
          // - safe today because of send ordering, but not something to rely on.
          part = FileUpload.fromContents(new Uint8Array(buffer.subarray(0, nextBytesRead)), part.fileName(), {
            mimeType: part.mimeType(),
          });
        }

        return await this.finishMultipartUpload<T>({ uploadId, parts });
      } catch (error) {
        try {
          await this.abortMultipartUpload(uploadId);
        } catch {
          // Surface the failure that broke the upload, not the cleanup's.
        }

        throw error;
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
}

/**
 * Reads until the buffer is full or the file ends.
 *
 * A single `read()` may return fewer bytes than asked for even mid-file - POSIX
 * permits it and network and overlay filesystems do it - which would produce a
 * part below the minimum size and fail the upload only at the finish step.
 */
async function readFull(handle: FileHandle, buffer: Buffer, length: number): Promise<number> {
  let filled = 0;

  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, null);

    if (bytesRead === 0) {
      break;
    }

    filled += bytesRead;
  }

  return filled;
}

/**
 * Builds the request body shared by create and update.
 *
 * The session appears in the body as well as the path on update; that is what the
 * server expects, so it is not redundant.
 */
function intakeBody(options: IntakeWriteOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    session: options.session,
    event: options.event,
    teleform_id: options.teleformId,
    data: options.data,
  };

  if (options.progress !== undefined) {
    body.progress = options.progress;
  }

  return body;
}

/**
 * Reads a required string out of a response payload.
 *
 * The multipart flow depends on two server-supplied values - the upload id and
 * each part's etag - and continuing without one produces a corrupt upload rather
 * than an error. So a missing or empty value fails here, loudly.
 */
function stringField(response: ApiResponse, key: string): string {
  const value = response.data()[key];

  if (typeof value !== 'string' || value === '') {
    throw new ApiError(`The server response did not include a usable ${key}.`, response.statusCode(), {});
  }

  return value;
}

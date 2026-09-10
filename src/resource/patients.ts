import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/** Options for {@link Patients.submitHealthInformation}. */
export interface SubmitHealthInformationOptions {
  /**
   * The health information to record. Forwarded unmodified; see the API
   * reference in your AsterMD dashboard for the accepted fields.
   */
  data: Record<string, unknown>;
  /**
   * Verification token proving the patient authorised this submission, sent as
   * the `x-phi-verification-token` header. Required by the server for
   * submissions that need explicit patient confirmation.
   */
  phiVerificationToken?: string;
}

/**
 * Patients - the person receiving care, and the most sensitive data in the SDK.
 *
 * A patient record is created once the prospect has qualified and is proceeding
 * with treatment, and it is what a clinician's review, a prescription, and an
 * order all hang from. Where an {@link Opportunities} record is a commercial
 * artifact, this is a clinical one.
 *
 * Everything on this resource carries personal and protected health information.
 * Two consequences worth knowing about:
 *
 * The SDK never writes a request or response body from any `patients/*` endpoint
 * to a debug log, even with `debugRedact: false` - those bodies are dropped
 * wholesale rather than masked. Debug entries for these calls show the method,
 * URL, and status only.
 *
 * Health-information submission is a two-step flow when the server requires
 * explicit patient confirmation: {@link Patients.verifyHealthInformationOtp}
 * confirms a one-time code the patient received, and the resulting token is
 * passed to {@link Patients.submitHealthInformation} as
 * `phiVerificationToken`.
 *
 * Handling this data does not by itself make your application HIPAA compliant -
 * that depends on your own infrastructure, policies, and agreements. Contact
 * info@astermd.com regarding a Business Associate Agreement.
 */
export class Patients extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Creates a patient record.
   *
   * Call this once the prospect has qualified and is proceeding. The payload is
   * forwarded unmodified, so it carries whatever demographic and contact fields
   * your organisation's configuration requires.
   *
   * @param data The patient's details. See the API reference in your AsterMD
   *   dashboard for the accepted fields.
   * @returns The created patient; `data()` carries the new record including its id.
   * @throws {ValidationError} If a field is missing or rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async create<T = Record<string, unknown>>(data: Record<string, unknown>): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/patients/create',
      body: data,
    });
  }

  /**
   * Fetches one patient record.
   *
   * Returns the record as your credentials are permitted to see it. Because the
   * organisation scope lives inside the JWT, an id belonging to another
   * organisation is indistinguishable from one that never existed - both raise
   * {@link NotFoundError}.
   *
   * @param id The patient's id.
   * @returns The patient record.
   * @throws {NotFoundError} If the patient does not exist or is out of scope.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async view<T = Record<string, unknown>>(id: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/patients/view/{id}',
      pathParams: { id },
    });
  }

  /**
   * Updates a patient record.
   *
   * Send only the fields you are changing; the server merges them into the
   * existing record rather than replacing it.
   *
   * @param id The patient's id.
   * @param data The fields to change.
   * @returns The updated patient record.
   * @throws {NotFoundError} If the patient does not exist.
   * @throws {ValidationError} If a field is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async update<T = Record<string, unknown>>(id: string, data: Record<string, unknown>): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'PUT',
      path: '/patients/update/{id}',
      pathParams: { id },
      body: data,
    });
  }

  /**
   * Changes a patient's status.
   *
   * A narrow call for the one field that drives workflow state, kept separate
   * from {@link Patients.update} so a status transition is explicit in your code
   * and in the server's audit trail. The accepted values are configured for your
   * organisation; see the API reference in your AsterMD dashboard.
   *
   * @param id The patient's id.
   * @param status The new status value.
   * @returns The updated patient record.
   * @throws {NotFoundError} If the patient does not exist.
   * @throws {ValidationError} If the status is not an accepted value.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async status<T = Record<string, unknown>>(id: string, status: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'PATCH',
      path: '/patients/status/{id}',
      pathParams: { id },
      body: { status },
    });
  }

  /**
   * Submits a patient's health information.
   *
   * This is the clinical questionnaire result a clinician reviews, and the most
   * sensitive payload the SDK carries. Where the server requires explicit patient
   * confirmation, obtain a token through
   * {@link Patients.verifyHealthInformationOtp} first and pass it as
   * `phiVerificationToken`.
   *
   * Neither the request nor the response body is ever written to a debug log.
   *
   * @param options The health information, and the verification token where one
   *   is required.
   * @returns The stored submission.
   * @throws {AuthenticationError} If the verification token is missing or invalid.
   * @throws {ValidationError} If the payload is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async submitHealthInformation<T = Record<string, unknown>>(
    options: SubmitHealthInformationOptions,
  ): Promise<ApiResponse<T>> {
    const headers =
      options.phiVerificationToken !== undefined ? { 'x-phi-verification-token': options.phiVerificationToken } : {};

    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/patients/health-information',
      body: options.data,
      headers,
    });
  }

  /**
   * Verifies the one-time code a patient was sent, before health information is
   * submitted.
   *
   * The confirming half of the two-step health-information flow. On success the
   * response carries the verification token to pass to
   * {@link Patients.submitHealthInformation}.
   *
   * The one-time code is a credential: it is never written to a debug log, and it
   * should not be written to yours either.
   *
   * @param data The patient identifier and the one-time code. See the API
   *   reference in your AsterMD dashboard for the exact fields.
   * @returns The verification result, carrying the token on success.
   * @throws {ValidationError} If the code is wrong, expired, or malformed.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async verifyHealthInformationOtp<T = Record<string, unknown>>(
    data: Record<string, unknown>,
  ): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/patients/health-information/otp-verification',
      body: data,
    });
  }
}

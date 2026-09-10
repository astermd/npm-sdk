import type { IdentityCheck } from '../enum/identity-check.js';
import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/**
 * Verification - checking that the details a prospect typed are real.
 *
 * Telehealth needs more confidence in an address, an email, and an identity than
 * ordinary commerce does: a prescription goes to a physical person at a physical
 * place. These endpoints proxy the provider configured for your organisation, and
 * normalise its answers, so your storefront gets one shape regardless of which
 * provider sits behind it.
 *
 * Address autofill and verification belong at the point of entry - autofill as
 * the buyer types, verification before checkout completes. Email verification
 * catches typos and disposable addresses before they cost you a lost patient.
 * Identity verification is the strongest check and is usually required before a
 * clinician will review a case; which variant applies is carried by
 * {@link IdentityCheck}.
 *
 * Note where these calls appear in debug logs. Redaction covers headers and
 * bodies but never the URL, and the address and email endpoints take their input
 * as a query parameter - so a debug entry for those calls contains the address or
 * email that was checked. That is worth knowing when deciding where debug logs
 * are written and how long they are kept. Identity verification is the exception:
 * it is a POST, and its body is dropped from logs entirely because it carries
 * PII.
 */
export class Verification extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Suggests complete addresses for a partial one.
   *
   * Built for a type-ahead: call it as the buyer types and render the
   * suggestions. Debouncing is your side's job - every keystroke here is a round
   * trip and counts against your request allowance.
   *
   * @param search The partial address typed so far.
   * @returns Candidate addresses from the configured provider.
   * @throws {ValidationError} If the search term is rejected.
   * @throws {RateLimitError} If the request allowance is exceeded.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async autofillAddress<T = Record<string, unknown>>(search: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'platform',
      method: 'GET',
      path: '/extensions/address-autofill',
      query: { search },
    });
  }

  /**
   * Verifies that an address exists and is deliverable.
   *
   * Call this before checkout completes rather than after: a prescription sent to
   * an undeliverable address is a clinical problem, not just a logistics one. The
   * response carries the provider's normalised form of the address, which is what
   * you should store.
   *
   * @param address The full address to verify.
   * @returns The verification result and the normalised address.
   * @throws {ValidationError} If the address is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async verifyAddress<T = Record<string, unknown>>(address: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'platform',
      method: 'GET',
      path: '/extensions/address-verify',
      query: { address },
    });
  }

  /**
   * Verifies that an email address is real and reachable.
   *
   * Catches typos and disposable addresses at the point of entry. Since every
   * later notification - intake reminders, clinician messages, shipping updates -
   * goes to this address, a bad one silently costs you the patient.
   *
   * @param email The email address to verify.
   * @returns The verification result.
   * @throws {ValidationError} If the address is malformed.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async verifyEmail<T = Record<string, unknown>>(email: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'platform',
      method: 'GET',
      path: '/extensions/email-verify',
      query: { email },
    });
  }

  /**
   * Runs an identity check against the configured provider.
   *
   * The strongest check available, and usually a precondition for clinical
   * review. Which variant runs is carried by `check`, and each expects a
   * different payload - see the API reference in your AsterMD dashboard for the
   * fields each one needs.
   *
   * The payload carries PII, and a Social Security Number in the `SsnVerify`
   * case. It is never written to a debug log, and it should not be written to
   * yours. The payload cannot override the check you selected.
   *
   * @param check Which identity check to run.
   * @param data The fields that check requires.
   * @returns The verification result.
   * @throws {ValidationError} If the payload does not satisfy the chosen check.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async verifyIdentity<T = Record<string, unknown>>(
    check: IdentityCheck,
    data: Record<string, unknown>,
  ): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'platform',
      method: 'POST',
      path: '/extensions/identity-verify',
      // Data first, slug last: the caller's payload must not rewrite the check.
      body: { ...data, slug: check },
    });
  }
}

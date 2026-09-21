import type { QueryParams } from '../http/url-builder.js';
import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/** The card network for {@link TreatmentCardOptions.type}. */
export type TreatmentCardType = 'amex' | 'visa' | 'mastercard' | 'discover' | 'diners_club' | 'jcb';

/** The settled payment method for {@link TreatmentPaymentOptions.type}. */
export type TreatmentPaymentType = 'paypal' | 'apple_pay' | 'gpay' | 'credit_card' | 'pre_paid';

/** The identity check performed for {@link TreatmentIdVerificationOptions.method}. */
export type TreatmentIdVerificationMethod = 'ssn' | 'dob' | 'cross_check' | 'document_upload';

/** Card details nested inside {@link TreatmentPaymentOptions.card}. */
export interface TreatmentCardOptions {
  /** The card network. */
  type: TreatmentCardType;
  /** The card's bank identification number, when available. */
  bin?: string;
  /** The card's expiry, in the format your integration agreed with AsterMD. */
  exp: string;
}

/** The settled payment method for {@link Treatments.sync}. */
export interface TreatmentPaymentOptions {
  /** How the order was paid for. */
  type: TreatmentPaymentType;
  /** Whether the payment was a pre-authorisation rather than a capture. */
  preAuth: boolean;
  /** Whether the pre-authorisation was a quality-assurance hold rather than a real charge. */
  preAuthQa?: boolean;
  /** The pre-authorised amount, when `preAuth` is true. */
  preAuthAmount?: number;
  /** Card details, when the payment method is card-based. */
  card?: TreatmentCardOptions;
}

/** The identity check nested inside {@link TreatmentVerificationOptions.id}. */
export interface TreatmentIdVerificationOptions {
  /** Whether the check passed. */
  verified: boolean;
  /** Which identity check was performed. */
  method: TreatmentIdVerificationMethod;
  /** The value that was checked, e.g. the SSN or date of birth submitted. */
  value: string;
}

/** Identity/contact verification already performed by the caller, for {@link Treatments.sync}. */
export interface TreatmentVerificationOptions {
  /** Whether the patient's email was verified. */
  email: boolean;
  /** Whether the patient's address was verified. */
  address: boolean;
  /** The identity check performed, if any. */
  id?: TreatmentIdVerificationOptions;
}

/** Options for {@link Treatments.sync}. */
export interface TreatmentSyncOptions {
  /** The session the orders belong to. */
  session: string;
  /** Order identifiers from your own commerce system. */
  orderIds: string[];
  /**
   * The visitor's user agent, forwarded as the required `User-Agent` header.
   * Since the SDK runs server-to-server, only the consuming application knows
   * the real value - read it from the incoming request and pass it here.
   */
  userAgent: string;
  /** Campaign attribution to record alongside the orders. */
  utmSource?: string;
  /** The settled payment method for the order. */
  payment?: TreatmentPaymentOptions;
  /** Identity/contact verification already performed by the caller. */
  verification?: TreatmentVerificationOptions;
}

/**
 * Treatments - the order, once money has actually changed hands.
 *
 * A treatment is the end of the order flow and the start of the clinical one:
 * the record a clinician reviews, prescribes against, and that fulfilment works
 * from. Create it *after* your own payment flow has settled, never before - the
 * SDK does not process payments, and a treatment recorded against an unsettled
 * payment puts an order into the clinical queue that may never be paid for.
 *
 * There are two ways to record one. {@link Treatments.create} takes the order
 * explicitly, which is what you want when your storefront owns checkout.
 * {@link Treatments.sync} takes a session and a list of order identifiers from
 * your own commerce system, which is what you want when checkout happened
 * elsewhere and you are reconciling after the fact.
 *
 * ```ts
 * await client.treatments().create({
 *   external_order_id: 'EXT-123',
 *   patient: { id: patientId },
 *   product: { id: productId },
 * });
 * ```
 */
export class Treatments extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Records a treatment - an order that has been paid for.
   *
   * Call this only after your payment flow has settled. Include your own order
   * identifier as `external_order_id` so the record can be reconciled against
   * your commerce system later.
   *
   * @param data The order: patient, product, your order identifier, and whatever
   *   else your configuration requires.
   * @returns The created treatment.
   * @throws {ValidationError} If a field is missing or rejected.
   * @throws {NotFoundError} If the referenced patient or product does not exist.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async create<T = Record<string, unknown>>(data: Record<string, unknown>): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/treatments/create',
      body: data,
    });
  }

  /**
   * Fetches one treatment, including its clinical status.
   *
   * This is how a storefront shows an order's progress - whether a clinician has
   * reviewed it, whether it has shipped.
   *
   * @param id The treatment's id.
   * @returns The treatment record.
   * @throws {NotFoundError} If the treatment does not exist or is out of scope.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async view<T = Record<string, unknown>>(id: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/treatments/view/{id}',
      pathParams: { id },
    });
  }

  /**
   * Lists treatments, filtered and paginated.
   *
   * Useful for an account area showing a patient's order history. Pagination
   * details come back in `meta()`; the accepted filters are in the API reference
   * in your AsterMD dashboard.
   *
   * @param query Filters and pagination parameters.
   * @returns The matching treatments, with pagination in `meta()`.
   * @throws {ValidationError} If a filter is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async list<T = Record<string, unknown>>(query: QueryParams = {}): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/treatments/list',
      query,
    });
  }

  /**
   * Reconciles orders placed in your own commerce system against a session.
   *
   * The alternative to {@link Treatments.create} for flows where checkout happens
   * outside your storefront: hand over the session and your order identifiers and
   * the server creates the treatments and attributes them to that session's
   * journey. Several orders can be reconciled in one call. `payment`, when
   * supplied, carries the settled payment method for the order; `verification`,
   * when supplied, records identity/contact verification already performed by
   * the caller.
   *
   * @param options The session, your order identifiers, the required user agent,
   *   and optional attribution, payment, and verification details.
   * @returns The created treatments.
   * @throws {TypeError} If `userAgent` is missing or empty.
   * @throws {ValidationError} If the session or an order identifier is rejected.
   * @throws {NotFoundError} If the session does not exist.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async sync<T = Record<string, unknown>>(options: TreatmentSyncOptions): Promise<ApiResponse<T>> {
    if (options.userAgent === undefined || options.userAgent === '') {
      throw new TypeError('Treatments.sync requires a non-empty userAgent.');
    }

    const body: Record<string, unknown> = {
      session_id: options.session,
      order_ids: options.orderIds,
    };

    if (options.utmSource !== undefined) {
      body.utm_source = options.utmSource;
    }

    if (options.payment !== undefined) {
      const payment: Record<string, unknown> = {
        type: options.payment.type,
        pre_auth: options.payment.preAuth,
      };

      if (options.payment.preAuthQa !== undefined) {
        payment.pre_auth_qa = options.payment.preAuthQa;
      }

      if (options.payment.preAuthAmount !== undefined) {
        payment.pre_auth_amount = options.payment.preAuthAmount;
      }

      if (options.payment.card !== undefined) {
        payment.card = options.payment.card;
      }

      body.payment = payment;
    }

    if (options.verification !== undefined) {
      body.verification = {
        email: options.verification.email,
        address: options.verification.address,
        ...(options.verification.id !== undefined ? { id: options.verification.id } : {}),
      };
    }

    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/treatments/sync',
      body,
      headers: { 'User-Agent': options.userAgent },
    });
  }
}

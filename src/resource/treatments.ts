import type { QueryParams } from '../http/url-builder.js';
import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/** Options for {@link Treatments.sync}. */
export interface TreatmentSyncOptions {
  /** The session the orders belong to. */
  session: string;
  /** Order identifiers from your own commerce system. */
  orderIds: string[];
  /** Campaign attribution to record alongside the orders. */
  utmSource?: string;
  /** The visitor's user agent, forwarded as the `User-Agent` header. */
  userAgent?: string;
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
   * journey. Several orders can be reconciled in one call.
   *
   * @param options The session, your order identifiers, and optional attribution.
   * @returns The created treatments.
   * @throws {ValidationError} If the session or an order identifier is rejected.
   * @throws {NotFoundError} If the session does not exist.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async sync<T = Record<string, unknown>>(options: TreatmentSyncOptions): Promise<ApiResponse<T>> {
    const body: Record<string, unknown> = {
      session_id: options.session,
      order_ids: options.orderIds,
    };

    if (options.utmSource !== undefined) {
      body.utm_source = options.utmSource;
    }

    const headers =
      options.userAgent !== undefined && options.userAgent !== '' ? { 'User-Agent': options.userAgent } : {};

    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/treatments/sync',
      body,
      headers,
    });
  }
}

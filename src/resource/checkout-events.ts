import { CheckoutEvent } from '../enum/checkout-event.js';
import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/** Currency recorded when the caller does not specify one. */
const DEFAULT_CURRENCY = 'USD';

/** Options for {@link CheckoutEvents.update}. */
export interface CheckoutEventUpdateOptions {
  /** The session whose checkout record is being advanced. */
  session: string;
  /** The funnel state now reached. */
  event: CheckoutEvent;
  /**
   * Additional context for this event - which upsell was shown, the order total,
   * a decline reason. Forwarded unmodified except that it can never override
   * `event`.
   */
  data?: Record<string, unknown>;
}

/**
 * Checkout events - the visitor's progress through the checkout funnel.
 *
 * Where {@link Sessions} records that a visit happened and {@link Carts} records
 * what was selected, this resource records what happened at the till: the
 * checkout page opening, each upsell offered and accepted or declined, and
 * finally whether the order was placed or declined. Together those events are
 * what makes checkout abandonment measurable.
 *
 * {@link CheckoutEvents.create} opens the record and always registers
 * `checkout_visited`; every later state goes through
 * {@link CheckoutEvents.update} with the matching {@link CheckoutEvent}. Neither
 * call can have its event overridden by the extra payload, so the funnel state
 * the server records is always the one the SDK's caller chose explicitly.
 */
export class CheckoutEvents extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Opens the checkout record for a session, registering `checkout_visited`.
   *
   * Call this once, when the visitor reaches the checkout page. The event is
   * fixed - this is the call that starts the funnel record - and `currency`
   * defaults to `USD` when you do not supply one, since the server requires a
   * currency to interpret any amounts in the payload.
   *
   * @param session The session reaching checkout.
   * @param data Additional context, e.g. `cart_total`, `items_count`,
   *   `currency`. Cannot override `session` or `event`.
   * @returns The created checkout-event record.
   * @throws {ValidationError} If the session or payload is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async create<T = Record<string, unknown>>(
    session: string,
    data: Record<string, unknown> = {},
  ): Promise<ApiResponse<T>> {
    // Data first, fixed keys last: PHP's `+` keeps the left operand on a
    // conflict, so the payload must not be able to rewrite session or event.
    const body: Record<string, unknown> = {
      ...data,
      session,
      event: CheckoutEvent.CheckoutVisited,
    };

    if (body.currency === undefined || body.currency === '') {
      body.currency = DEFAULT_CURRENCY;
    }

    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/checkout-events/create',
      body,
    });
  }

  /**
   * Advances a session's checkout record to a new funnel state.
   *
   * Send one call per state the visitor reaches: an upsell offered, then accepted
   * or declined, then the order placed or declined. The payload carries whatever
   * context that state needs, but it can never override `event` - the state
   * recorded is always the one you passed explicitly.
   *
   * @param options The session, the new state, and any context for it.
   * @returns The updated checkout-event record.
   * @throws {NotFoundError} If no checkout record exists for the session.
   * @throws {ValidationError} If the event or payload is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async update<T = Record<string, unknown>>(options: CheckoutEventUpdateOptions): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'PUT',
      path: '/checkout-events/update/{session_id}',
      pathParams: { session_id: options.session },
      body: { ...(options.data ?? {}), event: options.event },
    });
  }
}

import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/** Options for {@link Carts.create} and {@link Carts.update}. */
export interface CartWriteOptions {
  /** The session the cart belongs to. */
  session: string;
  /**
   * The cart's full contents. Each entry identifies a product and quantity, and
   * a variant where the product has them. This is the complete list, not a
   * delta - see the API reference in your AsterMD dashboard for the fields.
   */
  items: Record<string, unknown>[];
}

/**
 * Carts - what the visitor intends to buy, recorded against their session.
 *
 * The cart is a server-side record of intent, kept so abandonment can be measured
 * and so the eventual order can be reconciled against what was selected. It is
 * not a pricing engine and not a checkout: money is handled by your own payment
 * flow, and the resulting order arrives through
 * {@link Treatments.create} or {@link Treatments.sync}.
 *
 * Both methods take the cart's *whole* contents rather than a delta. Mirror your
 * storefront's cart state into `update()` whenever it changes, and the
 * server-side record stays in step with what the visitor is actually looking at.
 */
export class Carts extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Creates the cart for a session.
   *
   * Call this the first time the visitor puts something in their cart. The
   * session must already exist. If a cart is already recorded for the session,
   * use {@link Carts.update} instead.
   *
   * @param options The session and the cart's contents.
   * @returns The created cart.
   * @throws {ValidationError} If the session or an item is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async create<T = Record<string, unknown>>(options: CartWriteOptions): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/carts/create',
      body: { session: options.session, items: options.items },
    });
  }

  /**
   * Replaces the contents of a session's cart.
   *
   * The item list is authoritative: whatever you send becomes the cart. Send the
   * full list on every change rather than only what moved, and pass an empty list
   * to record that the visitor emptied their cart.
   *
   * @param options The session and the cart's new contents.
   * @returns The updated cart.
   * @throws {NotFoundError} If no cart exists for the session.
   * @throws {ValidationError} If an item is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async update<T = Record<string, unknown>>(options: CartWriteOptions): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'PUT',
      path: '/carts/update/{session}',
      pathParams: { session: options.session },
      body: { items: options.items },
    });
  }
}

import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/**
 * Channels - the storefront's own configuration, as the server holds it.
 *
 * A channel is one selling surface: a brand, a site, a campaign landing page.
 * Which products it may sell, which payment processor it uses, and which
 * questionnaires those products require are all channel-level configuration set
 * in your AsterMD dashboard. Your storefront reads that configuration rather than
 * duplicating it, so changing what a brand sells does not need a deployment.
 *
 * Three views, in increasing depth. {@link Channels.view} returns the channel
 * itself. {@link Channels.assignedProducts} returns what it may sell.
 * {@link Channels.details} returns the whole tree - channel, payment processor,
 * products, variants, prices, and per-integration mappings - in a single call,
 * which is what a storefront usually wants at boot.
 *
 * Channel configuration changes rarely. Fetch it rather than embedding a copy,
 * but caching the result for minutes is reasonable.
 */
export class Channels extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Fetches a channel's own configuration.
   *
   * The channel record itself - name, type, status - without its product
   * catalogue.
   *
   * @param id The channel's id.
   * @returns The channel record.
   * @throws {NotFoundError} If the channel does not exist or is out of scope.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async view<T = Record<string, unknown>>(id: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/channels/view/{id}',
      pathParams: { id },
    });
  }

  /**
   * Fetches the products assigned to a channel.
   *
   * What this selling surface is permitted to sell. Use it to build a catalogue
   * page without pulling the full detail tree.
   *
   * @param id The channel's id.
   * @returns The assigned products.
   * @throws {NotFoundError} If the channel does not exist.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async assignedProducts<T = Record<string, unknown>>(id: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/channels/assigned-products/{id}',
      pathParams: { id },
    });
  }

  /**
   * Fetches a channel's complete configuration tree.
   *
   * Channel, payment processor, products, variants, prices, and per-integration
   * mappings in one response - everything a storefront needs to render its
   * catalogue without further calls. The envelope is deeply nested and carries
   * server-side field names; see the API reference in your AsterMD dashboard for
   * its shape. Pass `data()` through {@link ChannelDetail.from} to flatten it.
   *
   * @param id The channel's id.
   * @returns The full configuration tree.
   * @throws {NotFoundError} If the channel does not exist.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async details<T = Record<string, unknown>>(id: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/channels/detail/{id}',
      pathParams: { id },
    });
  }
}

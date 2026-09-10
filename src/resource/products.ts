import type { QueryParams } from '../http/url-builder.js';
import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/**
 * Products - the read-only catalogue your storefront sells from.
 *
 * A product carries everything a storefront needs to render it: names,
 * descriptions, images, variants, prices, purchase quantity limits, and the
 * questionnaire a buyer must complete. All of it is configured in your AsterMD
 * dashboard, and the SDK only reads it - a storefront never creates or edits a
 * product.
 *
 * Which products a given selling surface may offer is a channel decision, so
 * {@link Channels.assignedProducts} and {@link Channels.details} are usually the
 * better starting point for a catalogue page. Reach for this resource when you
 * need the full product list regardless of channel, or one product by id.
 *
 * Image and asset paths come back relative. Resolve them with
 * `client.config().assetUrl(path)`, and treat the result as a fetch URL: download
 * the asset once and serve your own copy rather than hot-linking.
 */
export class Products extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Lists products, filtered and paginated.
   *
   * Pagination details come back in `meta()`. The accepted filters are in the
   * API reference in your AsterMD dashboard.
   *
   * @param query Filters and pagination parameters.
   * @returns The matching products, with pagination in `meta()`.
   * @throws {ValidationError} If a filter is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async list<T = Record<string, unknown>>(query: QueryParams = {}): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/products/list',
      query,
    });
  }

  /**
   * Fetches one product, including its variants and prices.
   *
   * @param id The product's id.
   * @returns The product record.
   * @throws {NotFoundError} If the product does not exist or is out of scope.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async view<T = Record<string, unknown>>(id: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/products/view/{id}',
      pathParams: { id },
    });
  }
}

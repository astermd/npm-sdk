import type { QueryParams } from '../http/url-builder.js';
import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/**
 * Shipping options - the delivery methods available for an order.
 *
 * Each option carries its name, price, and expected delivery window, which is
 * what a checkout page needs to let a buyer choose. Which options apply can depend
 * on the products in the cart and on the destination, so fetch them at checkout
 * rather than hardcoding a list.
 *
 * Read-only, and configured in your AsterMD dashboard.
 */
export class Shippings extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Lists shipping options, filtered and paginated.
   *
   * Pagination details come back in `meta()`. The accepted filters are in the
   * API reference in your AsterMD dashboard.
   *
   * @param query Filters and pagination parameters.
   * @returns The matching shipping options, with pagination in `meta()`.
   * @throws {ValidationError} If a filter is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async list<T = Record<string, unknown>>(query: QueryParams = {}): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/shippings/list',
      query,
    });
  }

  /**
   * Fetches one shipping option.
   *
   * @param id The shipping option's id.
   * @returns The shipping option record.
   * @throws {NotFoundError} If the shipping option does not exist or is out of scope.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async view<T = Record<string, unknown>>(id: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/shippings/view/{id}',
      pathParams: { id },
    });
  }
}

import type { QueryParams } from '../http/url-builder.js';
import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/**
 * Categories - how the catalogue is grouped for browsing.
 *
 * A category is a merchandising grouping a storefront renders as navigation: a
 * condition treated, a product family, a landing-page collection. Products
 * reference the categories they belong to, so fetching the category list is
 * usually the first call a catalogue page makes.
 *
 * Read-only, and configured in your AsterMD dashboard.
 */
export class Categories extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Lists categories, filtered and paginated.
   *
   * Pagination details come back in `meta()`. The accepted filters are in the
   * API reference in your AsterMD dashboard.
   *
   * @param query Filters and pagination parameters.
   * @returns The matching categories, with pagination in `meta()`.
   * @throws {ValidationError} If a filter is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async list<T = Record<string, unknown>>(query: QueryParams = {}): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/categories/list',
      query,
    });
  }

  /**
   * Fetches one category.
   *
   * @param id The category's id.
   * @returns The category record.
   * @throws {NotFoundError} If the category does not exist or is out of scope.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async view<T = Record<string, unknown>>(id: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/categories/view/{id}',
      pathParams: { id },
    });
  }
}

import type { QueryParams } from '../http/url-builder.js';
import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/**
 * Lab tests - the diagnostic panels a product may require.
 *
 * Some treatments cannot be prescribed without a result: a blood panel, a
 * hormone level. A lab test is the server-side definition of one such
 * requirement, and products reference the tests they depend on. A storefront reads
 * this to tell a buyer, before they pay, that a test will be part of their
 * treatment.
 *
 * Read-only, and configured in your AsterMD dashboard.
 */
export class LabTests extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Lists lab tests, filtered and paginated.
   *
   * Pagination details come back in `meta()`. The accepted filters are in the
   * API reference in your AsterMD dashboard.
   *
   * @param query Filters and pagination parameters.
   * @returns The matching lab tests, with pagination in `meta()`.
   * @throws {ValidationError} If a filter is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async list<T = Record<string, unknown>>(query: QueryParams = {}): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/lab-tests/list',
      query,
    });
  }

  /**
   * Fetches one lab test.
   *
   * @param id The lab test's id.
   * @returns The lab test record.
   * @throws {NotFoundError} If the lab test does not exist or is out of scope.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async view<T = Record<string, unknown>>(id: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/lab-tests/view/{id}',
      pathParams: { id },
    });
  }
}

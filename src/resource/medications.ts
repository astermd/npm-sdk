import type { QueryParams } from '../http/url-builder.js';
import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/**
 * Medications - the reference list of drugs the platform knows about.
 *
 * This is a lookup table, not a catalogue of things to sell: it is what a
 * storefront renders when an intake form asks "which medications are you
 * currently taking?" Answers picked from this list arrive at the clinician as
 * recognised drugs rather than free text, which is the difference between a
 * reviewable history and a paragraph someone has to interpret.
 *
 * List-only by design - the API exposes no single-medication endpoint, so
 * neither does the SDK. Filter through the query parameters to implement a
 * type-ahead rather than downloading the whole list.
 */
export class Medications extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Lists medications, filtered and paginated.
   *
   * Intended to back a search or type-ahead on an intake form. Pagination comes
   * back in `meta()`; the accepted filters are in the API reference in your
   * AsterMD dashboard.
   *
   * @param query Filters and pagination parameters.
   * @returns The matching medications, with pagination in `meta()`.
   * @throws {ValidationError} If a filter is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async list<T = Record<string, unknown>>(query: QueryParams = {}): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/medications/list',
      query,
    });
  }
}

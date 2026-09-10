import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/**
 * Opportunities - a prospect who has identified themselves and is worth
 * following up.
 *
 * This is the commercial record of the order flow, and the point where an
 * anonymous session becomes a named person. Create it once you have a name and a
 * contact address, typically right after the pre-qualifying form, and attach the
 * sessions that led to it so the whole journey stays connected:
 *
 * ```ts
 * const opportunity = await client.opportunities().create({
 *   first_name: 'Jane',
 *   email: 'jane@example.test',
 *   sessions: [session],
 * });
 * ```
 *
 * Attaching sessions is what makes attribution work: without them the server has
 * a lead with no idea where it came from. An opportunity can carry several
 * sessions, which is what you want when a prospect returns across devices or
 * days.
 *
 * Where this record is commercial, {@link Patients} is its clinical counterpart -
 * created later, once the prospect is actually proceeding with treatment.
 */
export class Opportunities extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Creates an opportunity.
   *
   * Include a `sessions` array of the session identifiers that led here, so the
   * server can attribute the lead. The rest of the payload is forwarded
   * unmodified.
   *
   * @param data The prospect's details and the sessions to attach.
   * @returns The created opportunity, including its id.
   * @throws {ValidationError} If a field is missing or rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async create<T = Record<string, unknown>>(data: Record<string, unknown>): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/opportunities/create',
      body: data,
    });
  }

  /**
   * Fetches one opportunity.
   *
   * @param id The opportunity's id.
   * @returns The opportunity record.
   * @throws {NotFoundError} If the opportunity does not exist or is out of scope.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async view<T = Record<string, unknown>>(id: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/opportunities/view/{id}',
      pathParams: { id },
    });
  }

  /**
   * Updates an opportunity.
   *
   * Send only the fields you are changing. Use this to enrich a lead as more
   * information arrives - a phone number, a later session to attach.
   *
   * @param id The opportunity's id.
   * @param data The fields to change.
   * @returns The updated opportunity.
   * @throws {NotFoundError} If the opportunity does not exist.
   * @throws {ValidationError} If a field is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async update<T = Record<string, unknown>>(id: string, data: Record<string, unknown>): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'PUT',
      path: '/opportunities/update/{id}',
      pathParams: { id },
      body: data,
    });
  }

  /**
   * Changes an opportunity's status.
   *
   * Kept separate from {@link Opportunities.update} so a pipeline transition is
   * explicit in your code and in the server's audit trail. The accepted values
   * are configured for your organisation; see the API reference in your AsterMD
   * dashboard.
   *
   * @param id The opportunity's id.
   * @param status The new status value, sent as `opportunity_status`.
   * @returns The updated opportunity.
   * @throws {NotFoundError} If the opportunity does not exist.
   * @throws {ValidationError} If the status is not an accepted value.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async status<T = Record<string, unknown>>(id: string, status: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'PATCH',
      path: '/opportunities/status/{id}',
      pathParams: { id },
      body: { opportunity_status: status },
    });
  }
}

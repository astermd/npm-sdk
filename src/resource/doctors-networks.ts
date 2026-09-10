import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/**
 * Doctors' networks - handing a case to the clinicians who will review it.
 *
 * A doctors' network is the panel of licensed clinicians configured for your
 * organisation. Syncing pushes a case to that panel so a clinician can pick it
 * up: it is the bridge between the commercial half of the order flow and the
 * clinical one.
 *
 * The single method here is unusual in the SDK for validating before it sends. A
 * sync with neither an opportunity to attach to nor enough detail to identify the
 * person would be accepted by the transport and rejected by the server, having
 * cost a round trip to learn something the SDK can see locally. So it checks
 * first, and raises `TypeError` rather than making the call.
 *
 * ```ts
 * await client.doctorsNetworks().sync({ opportunity_id: opportunityId });
 *
 * // or, without an opportunity yet:
 * await client.doctorsNetworks().sync({
 *   user_info: { first_name: 'Jane', email: 'jane@example.test' },
 * });
 * ```
 */
export class DoctorsNetworks extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Pushes a case to the configured doctors' network.
   *
   * The payload must identify who the case is about, one of two ways: an
   * `opportunity_id` for a prospect already recorded, or a `user_info` object
   * carrying at least `first_name` and `email` for one who is not. Everything
   * else is forwarded unmodified.
   *
   * An `emit_opportunity` key is removed before sending - that flag is the
   * server's to set, not a caller's. Your object is not modified; the SDK copies
   * it first.
   *
   * @param payload The case to push. Requires either a non-empty
   *   `opportunity_id` string, or a `user_info` object with non-empty
   *   `first_name` and `email` strings.
   * @returns The sync result.
   * @throws {TypeError} If the payload identifies neither an opportunity nor a
   *   person.
   * @throws {ValidationError} If the server rejects a field.
   * @throws {NotFoundError} If the referenced opportunity does not exist.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async sync<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<ApiResponse<T>> {
    // Copy before deleting: PHP's unset acts on a by-value array copy, but in JS
    // this object belongs to the caller.
    const body = { ...payload };
    delete body.emit_opportunity;

    validate(body);

    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/doctors-networks/sync',
      body,
    });
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * Requires the payload to identify the case's subject one of the two accepted
 * ways.
 *
 * @throws {TypeError} If it identifies neither.
 */
function validate(payload: Record<string, unknown>): void {
  const hasOpportunity = isNonEmptyString(payload.opportunity_id);

  const userInfo = payload.user_info;
  const hasMinimalUserInfo =
    typeof userInfo === 'object' &&
    userInfo !== null &&
    isNonEmptyString((userInfo as Record<string, unknown>).first_name) &&
    isNonEmptyString((userInfo as Record<string, unknown>).email);

  if (!hasOpportunity && !hasMinimalUserInfo) {
    throw new TypeError('doctors-networks/sync requires either opportunity_id or user_info with first_name + email.');
  }
}

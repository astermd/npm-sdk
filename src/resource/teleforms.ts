import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/**
 * Teleforms - the questionnaire definitions your storefront renders.
 *
 * A teleform is the server-side definition of a form: its fields, their types,
 * their order, and the validation the clinician's workflow expects. Both the
 * pre-qualifying questionnaire and the full intake questionnaire are teleforms.
 * Fetch the definition, render it in your own UI, and submit the answers through
 * {@link IntakeSubmissions} together with the teleform's id.
 *
 * There are two ways in. {@link Teleforms.viewByIdentifier} takes the stable
 * human-readable identifier you configured in your AsterMD dashboard, which is
 * what a storefront normally has hardcoded or in configuration.
 * {@link Teleforms.view} takes the generated id, which is what appears in API
 * responses elsewhere.
 *
 * Definitions change when someone edits the form in the dashboard, so fetch them
 * rather than embedding a copy - but they change rarely, so caching the result
 * for minutes rather than seconds is reasonable.
 */
export class Teleforms extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Fetches a teleform definition by its configured identifier.
   *
   * This is the call a storefront usually wants: the identifier is the stable
   * name you chose in your AsterMD dashboard, so it can live in your
   * configuration and survive the form being edited.
   *
   * @param identifier The teleform's configured identifier.
   * @returns The teleform definition.
   * @throws {NotFoundError} If no teleform carries that identifier.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async viewByIdentifier<T = Record<string, unknown>>(identifier: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/teleforms/view-url/{form_json_identifier}',
      pathParams: { form_json_identifier: identifier },
    });
  }

  /**
   * Fetches a teleform definition by its generated id.
   *
   * Use this when you already hold an id from another API response - a product's
   * assigned teleform, for instance - rather than a configured identifier.
   *
   * @param id The teleform's generated id.
   * @returns The teleform definition.
   * @throws {NotFoundError} If the teleform does not exist.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async view<T = Record<string, unknown>>(id: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/teleforms/view/{id}',
      pathParams: { id },
    });
  }
}

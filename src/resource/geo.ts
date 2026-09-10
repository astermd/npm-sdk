import type { Transport } from '../http/transport.js';
import type { Response as ApiResponse } from '../response.js';
import { AbstractResource } from './abstract-resource.js';

/**
 * Geo - where a visitor is, and whether you are allowed to serve them.
 *
 * Telehealth is licensed jurisdiction by jurisdiction, so location is not a
 * personalisation detail here - it decides whether an order flow may start at
 * all. These two endpoints answer the two different questions that follow from
 * that.
 *
 * {@link Geo.info} resolves an IP address to a location, which is what you want
 * for pre-filling a state selector or routing a visitor to the right regional
 * content. {@link Geo.blocklist} answers the narrower question of whether this
 * address is barred - a jurisdiction you are not licensed in, a known proxy or
 * anonymiser. Check the blocklist at the top of the funnel: turning a visitor
 * away on the landing page is far cheaper than doing it after they have completed
 * an intake questionnaire.
 *
 * Pass the *visitor's* address, not your server's. Behind a proxy or load
 * balancer that means reading the forwarded-for header your infrastructure sets,
 * with the same care you would apply anywhere else - that header is
 * caller-supplied unless your edge overwrites it.
 *
 * Both take their input as a query parameter, and redaction never covers the URL,
 * so a debug entry for these calls contains the IP address that was checked.
 */
export class Geo extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Resolves an IP address to a geographic location.
   *
   * Returns the configured provider's answer, normalised. Treat it as a strong
   * hint rather than proof - a VPN or a mobile carrier's routing can place a
   * visitor a long way from where they are. For a licensing decision, prefer
   * {@link Geo.blocklist} and the state the visitor declares.
   *
   * @param ip The visitor's IP address, v4 or v6.
   * @returns The resolved location.
   * @throws {ValidationError} If the address is malformed.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async info<T = Record<string, unknown>>(ip: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'platform',
      method: 'GET',
      path: '/extensions/geo-info',
      query: { ip },
    });
  }

  /**
   * Reports whether an IP address is barred from starting an order flow.
   *
   * Covers jurisdictions your organisation is not licensed for, along with known
   * proxies and anonymisers. Call it as early as the landing page: refusing a
   * visitor before they invest time in a questionnaire is better for them and
   * cheaper for you.
   *
   * @param ip The visitor's IP address, v4 or v6.
   * @returns The blocklist verdict.
   * @throws {ValidationError} If the address is malformed.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async blocklist<T = Record<string, unknown>>(ip: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'platform',
      method: 'GET',
      path: '/extensions/geo-blocklist',
      query: { ip },
    });
  }
}

import type { Response as ApiResponse } from '../response.js';
import type { Transport } from '../http/transport.js';
import { AbstractResource } from './abstract-resource.js';

/** Options for {@link Sessions.create}. */
export interface SessionCreateOptions {
  /**
   * Attribution and context to record against the session - UTM parameters,
   * referrer, landing page. Forwarded unmodified; see the API reference in your
   * AsterMD dashboard for the recognised keys.
   */
  data?: Record<string, unknown>;
  /** The visitor's user agent, forwarded as the `User-Agent` header. */
  userAgent?: string;
  /** The visitor's IP address, forwarded as the `X-Original-Client-Ip` header. */
  clientIp?: string;
}

/** Options for {@link Sessions.view}. */
export interface SessionViewOptions {
  /** Session identifiers to fetch. Sent as a comma-separated `session_ids` query. */
  sessions: string[];
  /** IANA time zone used to render timestamps in the response. */
  tz?: string;
}

/**
 * Sessions - the thread that ties one visitor's whole journey together.
 *
 * A session is the first thing an order flow creates and the value every later
 * call is attached to: intake submissions, the cart, checkout events, and finally
 * the opportunity. Creating one also records an implicit `visit_page` event
 * server-side, so the funnel starts measuring from that moment.
 *
 * Create the session as early as the visitor's first page view, keep the returned
 * identifier for the length of their visit - in a cookie or your own server-side
 * session - and pass it to every subsequent call:
 *
 * ```ts
 * const { session } = (
 *   await client.sessions().create<{ session: string }>({
 *     userAgent: request.headers['user-agent'],
 *     clientIp: request.ip,
 *   })
 * ).data();
 * ```
 *
 * Passing the visitor's user agent and IP matters: the server uses them for
 * attribution and geographic checks, and without them every session appears to
 * originate from your server rather than from the visitor.
 */
export class Sessions extends AbstractResource {
  /**
   * @param transport The shared transport.
   */
  constructor(transport: Transport) {
    super(transport);
  }

  /**
   * Creates a new session and returns its identifier.
   *
   * This is the first call of an order flow. The server records an implicit
   * `visit_page` event alongside the new session, so the funnel begins here.
   * Inspect `data().session` on the response for the identifier to thread through
   * every later call.
   *
   * @param options Attribution payload and visitor headers. All optional; with
   *   none, an empty object body is sent.
   * @returns The created session; `data()` holds `{ session }`.
   * @throws {ValidationError} If the attribution payload is rejected.
   * @throws {AuthenticationError} If the credentials are refused.
   * @throws {RateLimitError} If the organisation's request allowance is exceeded.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async create<T = Record<string, unknown>>(options: SessionCreateOptions = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {};

    if (options.userAgent !== undefined && options.userAgent !== '') {
      headers['User-Agent'] = options.userAgent;
    }

    if (options.clientIp !== undefined && options.clientIp !== '') {
      headers['X-Original-Client-Ip'] = options.clientIp;
    }

    return await this.transport.send<T>({
      service: 'sales',
      method: 'POST',
      path: '/sessions/create',
      body: options.data ?? {},
      headers,
    });
  }

  /**
   * Fetches one or more sessions and the events recorded against them.
   *
   * Useful for reconstructing a visitor's journey server-side - which forms they
   * touched, where they stopped. Several identifiers can be fetched in one call,
   * which is cheaper than looping. Timestamps come back in `tz` when you supply
   * one, and in the organisation's default zone otherwise.
   *
   * @param options The session identifiers to fetch, and an optional time zone.
   * @returns The sessions and their recorded events.
   * @throws {NotFoundError} If none of the identifiers resolve.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async view<T = Record<string, unknown>>(options: SessionViewOptions): Promise<ApiResponse<T>> {
    const query: Record<string, string> = {
      session_ids: options.sessions.join(','),
    };

    if (options.tz !== undefined && options.tz !== '') {
      query.tz = options.tz;
    }

    return await this.transport.send<T>({
      service: 'sales',
      method: 'GET',
      path: '/sessions/view',
      query,
    });
  }

  /**
   * Updates the attribution and context recorded against an existing session.
   *
   * Call this when information arrives after the session was created - a UTM
   * parameter only present on a later page, a referrer resolved asynchronously.
   * The payload is merged server-side rather than replacing what is already
   * recorded.
   *
   * @param session The session identifier to update.
   * @param data Fields to record. Forwarded unmodified; see the API reference in
   *   your AsterMD dashboard for the recognised keys.
   * @returns The updated session.
   * @throws {NotFoundError} If the session does not exist.
   * @throws {ValidationError} If the payload is rejected.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async update<T = Record<string, unknown>>(
    session: string,
    data: Record<string, unknown> = {},
  ): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'PUT',
      path: '/sessions/update/{id}',
      pathParams: { id: session },
      body: data,
    });
  }

  /**
   * Deletes a session and the events recorded against it.
   *
   * Intended for honouring a visitor's erasure request, not for ordinary
   * cleanup - sessions age out server-side on their own. Deleting one removes the
   * attribution trail for anything that referenced it.
   *
   * @param session The session identifier to delete.
   * @returns The deletion confirmation.
   * @throws {NotFoundError} If the session does not exist.
   * @throws {ApiError} On any other non-2xx status.
   * @throws {TransportError} If the request never completed.
   */
  async delete<T = Record<string, unknown>>(session: string): Promise<ApiResponse<T>> {
    return await this.transport.send<T>({
      service: 'sales',
      method: 'DELETE',
      path: '/sessions/delete/{id}',
      pathParams: { id: session },
    });
  }
}

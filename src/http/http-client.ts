/**
 * The SDK's HTTP injection seam: one method, taking a platform `Request` and
 * returning a platform `Response`.
 *
 * The default implementation is {@link FetchHttpClient}, which wraps the global
 * `fetch`. Supplying your own is how you route SDK traffic through a proxy
 * agent, add your own retry policy, pin TLS settings, or stub the network out in
 * tests:
 *
 * ```ts
 * class ProxiedHttpClient implements HttpClient {
 *   async sendRequest(request: Request): Promise<Response> {
 *     return await fetch(request, { dispatcher: myProxyAgent });
 *   }
 * }
 *
 * const client = new AsterMDClient({
 *   clientId: process.env.ASTERMD_CLIENT_ID!,
 *   clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
 *   httpClient: new ProxiedHttpClient(),
 * });
 * ```
 *
 * An implementation should let a network-level failure surface as
 * {@link TransportError}. {@link Transport} wraps anything else this throws
 * into a {@link TransportError} as well, so every error reaching a caller of
 * the SDK still extends {@link AsterMDError} - but that is a safety net, not
 * licence to throw arbitrary values: prefer throwing {@link TransportError}
 * directly, or an {@link AsterMDError} subclass, so the original error type is
 * preserved rather than rewrapped.
 *
 * The debug logger is itself an implementation of this interface that decorates
 * another one, which is how a single seam covers both API traffic and the
 * credential exchange.
 */
export interface HttpClient {
  /**
   * Sends one request and resolves with the response.
   *
   * @param request The fully-built request, including URL, method, headers, and
   *                body. Implementations must not mutate it.
   * @returns The response as received. A non-2xx status is a normal return, not
   *          an error - {@link Transport} maps statuses to errors.
   * @throws {TransportError} On a network-level failure, where no response
   *   arrived.
   */
  sendRequest(request: Request): Promise<Response>;
}

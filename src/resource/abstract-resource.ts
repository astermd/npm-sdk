import type { Transport } from '../http/transport.js';

/**
 * Base class for every SDK resource; holds the shared {@link Transport}.
 *
 * Resource classes extend this and call `this.transport.send()` to dispatch every
 * outbound request. A resource never builds a request, touches a header, or
 * decodes JSON - all of that belongs to `Transport` alone. That is what keeps
 * seventeen resource classes small enough to read at a glance and testable
 * without a network.
 */
export abstract class AbstractResource {
  /** The shared transport used for all outbound API calls. */
  protected readonly transport: Transport;

  /**
   * @param transport The transport every call from this resource goes through.
   */
  protected constructor(transport: Transport) {
    this.transport = transport;
  }
}

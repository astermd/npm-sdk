import { ApiError } from './api-error.js';

/**
 * The addressed resource does not exist (HTTP 404).
 *
 * Raised when an id in the request path matches nothing the calling organisation
 * can see. Note that the organisation scope lives inside the JWT, so an id
 * belonging to another organisation is indistinguishable from one that never
 * existed - both arrive here.
 */
export class NotFoundError extends ApiError {
  constructor(message: string, statusCode: number, envelope: Record<string, unknown>) {
    super(message, statusCode, envelope);
    this.name = 'NotFoundError';
  }
}

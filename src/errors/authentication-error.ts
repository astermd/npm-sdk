import { ApiError } from './api-error.js';

/**
 * The API rejected the credentials or the bearer token (HTTP 401).
 *
 * The SDK does not raise this on the first 401. {@link TokenManager} refreshes
 * the token and the request is replayed once; only a second 401 surfaces here.
 * So seeing this error means a fresh token was also refused - check the client ID
 * and secret, and that the credentials are still active in your AsterMD
 * dashboard.
 */
export class AuthenticationError extends ApiError {
  constructor(message: string, statusCode: number, envelope: Record<string, unknown>) {
    super(message, statusCode, envelope);
    this.name = 'AuthenticationError';
  }
}

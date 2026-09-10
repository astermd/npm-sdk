import { describe, expect, it } from 'vitest';
import * as sdk from '../src/index.js';

describe('public surface', () => {
  it('exports every documented value', () => {
    const expected = [
      'AsterMDClient',
      'Config',
      'Response',
      'AbstractResource',
      'Sessions',
      'IntakeSubmissions',
      'Carts',
      'CheckoutEvents',
      'Teleforms',
      'Patients',
      'Opportunities',
      'Treatments',
      'DoctorsNetworks',
      'Channels',
      'Products',
      'Categories',
      'LabTests',
      'Medications',
      'Shippings',
      'Verification',
      'Geo',
      'ChannelDetail',
      'QueryParamCipher',
      'Event',
      'CheckoutEvent',
      'IdentityCheck',
      'Token',
      'InMemoryTokenStore',
      'FileTokenStore',
      'FetchHttpClient',
      'FileUpload',
      'DailyFileLogSink',
      'AsterMDError',
      'TransportError',
      'ApiError',
      'AuthenticationError',
      'NotFoundError',
      'ValidationError',
      'RateLimitError',
    ].sort();

    expect(Object.keys(sdk).sort()).toEqual(expected);
  });

  it('does not leak internal machinery', () => {
    const internals = ['Transport', 'TokenManager', 'UrlBuilder', 'LogRedactor', 'CurlFormatter', 'LoggingHttpClient'];

    for (const name of internals) {
      expect(sdk).not.toHaveProperty(name);
    }
  });
});

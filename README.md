# AsterMD Node.js SDK

Slim, framework-agnostic TypeScript SDK for the AsterMD order-flow API.

- Node `>=22`
- **Zero runtime dependencies** - the platform `fetch`, `node:crypto`, and `node:fs` only
- Dual ESM + CJS builds with full type declarations
- Bring your own HTTP client if you prefer

## Install

```bash
npm install @astermd-hq/sdk
```

## Quick start

```ts
import { AsterMDClient, Event } from '@astermd-hq/sdk';

const client = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
});

// 1. Start a session (implicit `visit_page` event server-side)
const { session } = (await client.sessions().create<{ session: string }>()).data();

// 2. Pre-qualifying form
await client.intakeSubmissions().create({
  session,
  event: Event.PreQualifyingInitiated,
  teleformId: 'your-teleform-id',
  // `data` is a list of field objects: id / name / label / type / value
  data: [{ id: 'name-1', name: 'name', label: 'Full name', type: 'text', value: [{ value: 'Jane' }] }],
});

// 3. Create the opportunity, attaching the session
const opportunity = await client.opportunities().create({
  first_name: 'Jane',
  email: 'jane@example.com',
  sessions: [session],
});

// 4. Intake
await client.intakeSubmissions().update({
  session,
  event: Event.IntakeCompleted,
  teleformId: 'your-teleform-id',
  data: [
    { id: 'name-1', name: 'name', label: 'Full name', type: 'text', value: [{ value: 'Jane' }] },
    {
      id: 'dob-1',
      name: 'dob',
      label: 'Date of birth',
      type: 'date',
      value: [{ value: '1990-01-15' }],
    },
  ],
});

// 5. After external payment settles, create the treatment (= order)
await client.treatments().create({
  external_order_id: 'EXT-123',
  patient: { id: '...' },
  product: { id: '...' },
});
```

Credentials are issued from your AsterMD dashboard, which is also where the full
API reference lives. Load the secret from an environment variable or a secrets
manager - never commit it, and never ship it to a browser. This SDK is
server-side only.

Construct the client once and share it: it caches the bearer token, so a client
per request throws that cache away.

## Resources

`sessions`, `intakeSubmissions`, `carts`, `checkoutEvents`, `teleforms`,
`patients`, `opportunities`, `treatments`, `doctorsNetworks`, `channels`,
`products`, `categories`, `labTests`, `medications`, `shippings`,
`verification`, `geo`.

## Errors

Every error extends `AsterMDError`:

- `TransportError` - network failure, no response received
- `AuthenticationError` - 401
- `NotFoundError` - 404
- `ValidationError` - 422 (`.fieldErrors()`)
- `RateLimitError` - 429 (`.retryAfter()`)
- `ApiError` - other 4xx/5xx (`.statusCode()`, `.envelope()`)

```ts
import { RateLimitError, ValidationError } from '@astermd-hq/sdk';

try {
  await client.patients().create({/* ... */});
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(error.fieldErrors());
  } else if (error instanceof RateLimitError) {
    await new Promise(resolve => setTimeout(resolve, (error.retryAfter() ?? 5) * 1000));
  } else {
    throw error;
  }
}
```

## Token storage

By default the bearer token is cached in memory for the life of the process,
which is what a long-running server wants. Where each request runs in a fresh
process or isolate, that cache is never hit - use `FileTokenStore`, or implement
`TokenStore` against Redis or any other shared store.

```ts
import { AsterMDClient, FileTokenStore } from '@astermd-hq/sdk';

const client = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
  tokenStore: new FileTokenStore('/var/cache/astermd/token.json'),
});
```

## Debugging

Pass `debug: true` with a `debugFile` to log every request as a copy-pasteable
curl command plus its response.

```ts
const client = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
  debug: true,
  debugFile: '/var/log/astermd/sdk.log',
});
```

**Credentials are redacted by default.** Bearer tokens, the client secret, PHI
verification tokens, and the bodies of `patients/*` calls are replaced with
`[REDACTED]`:

```
curl --location --request POST 'https://api.astermd.com/v1/sales/sessions/create' \
  --header 'authorization: Bearer [REDACTED]' \
  --header 'content-type: application/json' \
  --data '{}'

# Response: HTTP 200
{"success":true,"message":"ok","data":{"session":"..."}}
```

Pass `debugRedact: false` to log verbatim, including the live JWT. Never do that
in production. Note that redaction covers headers and bodies but not the URL, so
endpoints taking their input as a query parameter log that input.

### Log rotation

`debugFile` is a _base path_. The SDK writes one file per day derived from it and
deletes files older than `debugRetentionDays` (default 7; `0` keeps everything):

```
/var/log/astermd/sdk-2026-09-08.log
/var/log/astermd/sdk-2026-09-07.log
```

Pruning happens once per sink instance, and only files matching the SDK's own
`{name}-YYYY-MM-DD.{ext}` pattern are ever removed.

### Sending logs somewhere else

Supply a `debugSink` and the SDK writes no files at all - retention and delivery
become yours. This works with any destination: a logger, a hosted log service, a
cloud provider's logging API, a queue.

```ts
const client = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
  debug: true,
  debugSink: entry => logger.debug(entry),
});
```

See [`docs/INTEGRATION_GUIDE.md`](docs/INTEGRATION_GUIDE.md) for worked examples.

## Bringing your own HTTP client

The SDK talks to one small interface, so anything that can send a `Request` can
be swapped in - a proxy agent, your own retry policy, a test stub.

```ts
import { AsterMDClient, type HttpClient } from '@astermd-hq/sdk';

class InstrumentedHttpClient implements HttpClient {
  async sendRequest(request: Request): Promise<Response> {
    const started = performance.now();
    try {
      return await fetch(request);
    } finally {
      metrics.timing('astermd.request', performance.now() - started);
    }
  }
}

const client = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
  httpClient: new InstrumentedHttpClient(),
});
```

## Development

```bash
npm install
npm run ci        # lint → format → typecheck → test → build → publint
# also: npm test, npm run lint, npm run fix, npm run typecheck, npm run coverage
```

A `Makefile` wraps the same scripts (`make install`, `make ci`, `make test`) if
you prefer.

## Compliance

This SDK is a client for an API that carries personal and protected health
information. Using it does not by itself make your application HIPAA compliant -
that depends on your own infrastructure, policies, and agreements. Contact
info@astermd.com regarding a Business Associate Agreement.

See [`SECURITY.md`](SECURITY.md) for vulnerability reporting and
credential-handling guidance.

## Further reading

| Audience                            | Document                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Integrators building on the SDK** | [`docs/INTEGRATION_GUIDE.md`](docs/INTEGRATION_GUIDE.md) - order flow, resources, auth lifecycle, framework recipes |
| Contributors                        | [`CONTRIBUTING.md`](CONTRIBUTING.md) - local setup, how to add an endpoint                                          |
| Architecture                        | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - single-page overview                                               |
| Changes                             | [`CHANGELOG.md`](CHANGELOG.md)                                                                                      |

## Support

Questions, access requests, and licensing enquiries: **info@astermd.com**

## License

[MIT](LICENSE) © 2026 AsterMD

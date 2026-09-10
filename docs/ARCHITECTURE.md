# Architecture

Single-page overview of how the `@astermd-hq/sdk` package is wired together.
For end-user usage see `docs/INTEGRATION_GUIDE.md`.

## Layers

```
┌──────────────────────────────────────────────────────────────────────┐
│  Consumer application (Express / Fastify / Next.js / plain Node.js)  │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────────┐
│  AsterMDClient                 ← entry point, holds collaborators     │
│   • config()                                                          │
│   • sessions()  intakeSubmissions()  teleforms()  patients()          │
│   • opportunities()  treatments()  doctorsNetworks()  channels()      │
│   • products() categories() labTests() medications() shippings()      │
│   • verification()  geo()                                             │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                ┌─────────────┴──────────────┐
                │                            │
┌───────────────▼─────────────┐  ┌───────────▼──────────────────┐
│  Resource\*                 │  │  Auth\TokenManager           │
│   thin wrappers, one        │  │   lazy acquire / refresh,    │
│   method per endpoint;      │  │   30s pre-buffer, single     │
│   no HTTP, no JSON          │  │   401 auto-retry, dedupe     │
└───────────────┬─────────────┘  └───────────┬──────────────────┘
                │                            │
                └──────────────┬─────────────┘
                               │
                  ┌────────────▼─────────────┐
                  │  Http\Transport          │
                  │   • fresh Request/attempt│
                  │   • Bearer token attach  │
                  │   • envelope decode      │
                  │   • status → error class │
                  └────────────┬─────────────┘
                               │
                  ┌────────────▼─────────────┐
                  │  HttpClient interface    │
                  │  (FetchHttpClient by     │
                  │   default; pluggable)    │
                  └──────────────────────────┘
```

## File map

```
src/
├── astermd-client.ts        entry point; wires Config + TokenManager + Transport, 17 memoized accessors
├── config.ts                immutable value object (clientId, secret, host, timeout, assetUrl())
├── response.ts               immutable response (statusCode, data, meta, message, raw)
├── index.ts                  public barrel — the only entry point consumers import
├── auth/
│   ├── token.ts               value object (value, expiresAt, isExpired pre-buffer)
│   ├── token-store.ts         interface — pluggable, asynchronous persistence
│   ├── in-memory-token-store.ts  default; per-process only, does not survive between processes
│   ├── file-token-store.ts    file-backed store; survives across processes, 0o600 permissions
│   └── token-manager.ts       owns its OWN no-auth Transport for token exchange; dedupes concurrent acquisition
├── http/
│   ├── file-upload.ts         immutable file + name + MIME type for multipart requests
│   ├── http-client.ts         HttpClient interface — the injection seam
│   ├── fetch-http-client.ts   default HttpClient; wraps fetch, AbortSignal timeout
│   ├── curl-formatter.ts      formats a Request as a copy-pasteable curl command
│   ├── logging-http-client.ts HttpClient decorator that logs requests + responses when debug=true
│   ├── log-redactor.ts        masks tokens, secrets, and PHI in debug output (on by default)
│   ├── url-builder.ts         builds /v1/{service}/{path} URLs, PHP-compatible encoding
│   └── transport.ts           the single HTTP chokepoint
├── log/
│   └── daily-file-log-sink.ts built-in debug sink; one file per day, serialized writes, prunes old files
├── resource/
│   ├── abstract-resource.ts   base; only knows about Transport
│   ├── sessions.ts            /v1/sales/sessions/*
│   ├── intake-submissions.ts  /v1/sales/intake-submissions/*, plus file and multipart uploads
│   ├── carts.ts                /v1/sales/carts/*
│   ├── checkout-events.ts     /v1/sales/checkout-events/*
│   ├── teleforms.ts            /v1/sales/teleforms/*
│   ├── patients.ts             /v1/sales/patients/*
│   ├── opportunities.ts       /v1/sales/opportunities/*
│   ├── treatments.ts           /v1/sales/treatments/*
│   ├── doctors-networks.ts    /v1/sales/doctors-networks/sync (+ client-side validation)
│   ├── channels.ts             /v1/sales/channels/*
│   ├── products.ts             /v1/sales/products/*
│   ├── categories.ts           /v1/sales/categories/*
│   ├── lab-tests.ts            /v1/sales/lab-tests/*
│   ├── medications.ts          /v1/sales/medications/list  (list-only)
│   ├── shippings.ts            /v1/sales/shippings/*
│   ├── verification.ts        /v1/platform/extensions/{address,email,identity}-*
│   └── geo.ts                  /v1/platform/extensions/geo-*
├── presenter/
│   └── channel-detail.ts      read model over the channel detail envelope
├── support/
│   └── query-param-cipher.ts  AES-128-CBC codec for encrypted URL params (caller supplies the key)
├── enum/
│   ├── event.ts                pre_qualifying_* / intake_* events
│   ├── checkout-event.ts      checkout_visited / upsell_* / order_* events
│   └── identity-check.ts      crosscheck / dob_verify / ssn_verify
└── errors/
    ├── astermd-error.ts       abstract base
    ├── transport-error.ts     network failure (no HTTP response)
    └── api-error.ts           base for everything with a status code
        ├── authentication-error.ts   (401, after one auto-retry)
        ├── not-found-error.ts        (404)
        ├── validation-error.ts       (422 + fieldErrors)
        └── rate-limit-error.ts       (429 + retryAfter)
```

## Request lifecycle

For a typical authenticated call (e.g. `patients().view('p-1')`):

1. **Resource method** is invoked on the user's `AsterMDClient` accessor. The
   resource calls `this.transport.send({ service: 'sales', method: 'GET', path:
'/patients/view/{id}', pathParams: { id: 'p-1' } })`.
2. **`Transport.send()`** calls the injected `tokenProvider` closure. In the
   production wiring this closure delegates to `TokenManager.bearerToken()`.
3. **`TokenManager`** checks its `TokenStore` for a non-expired token. If found,
   returns the JWT string. Otherwise it dispatches a token-exchange request
   through its own _separate_, _unauthenticated_ `Transport` to `POST
/v1/auth/api-credentials/token`, parses `access_token` +
   `access_token_expiry`, stores the result, and returns the JWT.
4. **`Transport`** builds the request URL via `UrlBuilder`
   (`https://{host}/v1/{service}/{path}`), sets `Authorization: Bearer <jwt>` and
   `Accept: application/json`, attaches any extra headers (e.g.
   `x-phi-verification-token`), and encodes the body if present. A `FileUpload`
   passed instead of a JSON body is encoded as a single-part
   `multipart/form-data` body under the field name `file` via `FormData`, with a
   fresh boundary per request; the two are mutually exclusive. **A fresh
   `Request` is built per attempt** — a `fetch` request body is a single-use
   stream, so replaying an already-sent `Request` would transmit an empty body
   silently, not the original one.
5. **`HttpClient`** sends the request. By default this is `FetchHttpClient`
   (the platform `fetch`, plus an `AbortSignal.timeout()` deadline). A network
   failure or a timed-out signal raises `TransportError`. `Transport` itself
   also wraps anything an injected `HttpClient` throws that is not already an
   `AsterMDError` into `TransportError`, so the error contract holds even for a
   custom implementation that throws a bare `Error`.
6. **`Transport`** reads the response status. If 2xx, it decodes the envelope
   and returns a `Response`. If 401, it calls the `onUnauthorized` closure —
   which delegates to `TokenManager.refresh()` — and replays the request once
   (rebuilding it fresh, per step 4). If the replay still 401s (or for any
   non-2xx other than the single 401 retry path), it maps the status to the
   matching error subclass and throws.
7. **Resource method** returns the `Response` value object to the caller.

## Why two transports for token acquisition

A naive `TokenManager` that called the SDK's main `Transport` to fetch its token
would recurse infinitely on the first call: the main `Transport` would ask
`TokenManager` for a bearer token, `TokenManager` would call `Transport` to fetch
one, which would ask `TokenManager` again, and so on.

The fix is straightforward: `TokenManager` constructs a private `Transport` with
`tokenProvider: () => Promise.resolve(null)` and `onUnauthorized: () =>
Promise.resolve(false)`. That transport sends the credential exchange and
nothing else — it can't recurse because it neither provides nor expects a
bearer token.

## Why the SDK is so small

The contract intentionally exposes only the order-flow surface (auth, sessions,
intake-submissions, patients, opportunities, treatments, doctors-networks,
channels, catalog). Administrative surfaces — analytics, reporting, org/role
management, and integration management — are out of scope and will stay out.
They are managed from the AsterMD dashboard, and they are not what an
integrating application needs.

This is the Stripe model: a deliberate, curated surface rather than an
exhaustive 1-to-1 wrapper around every endpoint.

## Invariants that future changes must preserve

- **`Transport` is the only place that touches HTTP, JSON, or `Request` /
  `Response` types.** Resources never see them.
- **`TokenManager` is the only place that exchanges credentials for a JWT.**
- **`TokenManager` holds its own `Transport`**, built with `tokenProvider: () =>
Promise.resolve(null)` and `onUnauthorized: () => Promise.resolve(false)`, so
  token acquisition cannot recurse.
- **`org_id` lives in the JWT** — never as an SDK argument or per-request header.
- **`AsterMDClient` accepts a host, not a URL.** It always builds
  `/v1/{service}/{path}` itself.
- **The default transport is the platform `fetch`.** A consumer may swap in any
  `HttpClient`; the SDK must never depend on a specific implementation.
- **Internal classes (`Transport`, `FetchHttpClient`, `UrlBuilder`,
  `TokenManager`, `LogRedactor`, `DailyFileLogSink`) are not designed for
  extension. Resource classes are extendable.**
- **Value objects (`Config`, `Token`, `Response`) are immutable** — `Object.freeze`
  in the constructor, `readonly` fields.

If a proposed change violates any of these, raise it on a PR first — the small
surface is the value.

## Divergences from the PHP SDK

The port is deliberate, not literal. Nine points differ from `astermd/sdk`,
each forced by the platform or chosen for a reason worth stating explicitly:

1. **A fresh `Request` is built per attempt.** A `fetch` request body is a
   single-use stream, so replaying a sent request would transmit an empty body
   silently.
2. **`TokenStore` is asynchronous**, so a consumer can back it with Redis or any
   other remote store, not only local memory or the filesystem.
3. **Token acquisition is de-duplicated** by an in-flight promise, cleared in a
   `finally` so a failed exchange is not cached.
4. **Debug sinks may be asynchronous**; `DailyFileLogSink` serializes writes
   through a promise chain and swallows its own I/O errors.
5. **Multipart bodies use `FormData` + `Blob`**; `uploadLargeFile` streams one
   part at a time from disk, holding only `partSize` bytes in memory at once.
6. **`QueryParamCipher` keeps PHP's `[{key, value}]` wire format** for
   compatibility, but exposes an object-shaped API — a plain
   `Record<string, string>` in and out — because that is what a JS caller wants.
7. **`TypeError` replaces `InvalidArgumentException`** for client-side argument
   validation (a doctors-network sync missing both an opportunity and minimal
   user info, an out-of-range multipart part number or size, an empty parts
   list).
8. **Timeouts use `AbortSignal.timeout()`**; an abort surfaces as
   `TransportError`, uniformly with every other network-level failure —
   including a body read that fails mid-stream, and anything an injected
   `HttpClient` throws that is not already an `AsterMDError`, both of which
   `Transport` normalises into `TransportError` at the dispatch and
   response-reading chokepoints.
9. **`DailyFileLogSink` creates its log directory lazily on first write**,
   because a constructor cannot `await`.

## Debug decorator placement

`AsterMDClient` applies `LoggingHttpClient` _before_ handing the client to
`TokenManager`, so one decorator covers the credential exchange as well as
every resource call. It wraps below `TokenManager` in the collaborator graph —
between `AsterMDClient` and every downstream consumer of the `HttpClient` seam
— without `Transport` or `TokenManager` needing to know it exists.

Because that decorator is the only place that ever sees the credential
exchange in cleartext, it is also the only place in the SDK that could leak a
credential. A `LogRedactor` is attached by default and masks bearer tokens, the
client secret, PHI verification tokens, `patients/*` bodies, and the raw bytes
of file uploads before anything reaches the sink; `debugRedact: false` removes
it, and should never be set outside a non-production credential set. Sink
behaviour is likewise pluggable: `DailyFileLogSink` handles the built-in
dated-file-plus-retention case, and any `debugSink` function replaces it
entirely.

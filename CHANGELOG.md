# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.3] - 2026-09-21

### Changed

- **BREAKING:** `treatments().sync()` now requires `userAgent`; an empty or
  missing value throws `TypeError`. Adds optional `payment` and `verification`
  fields, with new exported types `TreatmentPaymentOptions`,
  `TreatmentCardOptions`, `TreatmentVerificationOptions`, and
  `TreatmentIdVerificationOptions`.
- Documented the optional `variant_id` cart-item field on `carts().create()`
  and `carts().update()`, the optional `payment` field on an `OrderPlaced`
  `checkoutEvents().update()` event, and the optional `verification` field on
  `sessions().create()` and `sessions().update()`. All three were already
  forwarded as pass-through payload; only the documentation changed.

## [0.0.2] - 2026-09-08

First public release of the Node.js SDK, at feature parity with the PHP SDK
v0.0.2.

### Added

- `AsterMDClient` entry point wrapping the AsterMD order-flow API, with
  seventeen memoized resource accessors: `sessions`, `intakeSubmissions`,
  `carts`, `checkoutEvents`, `teleforms`, `patients`, `opportunities`,
  `treatments`, `doctorsNetworks`, `channels`, `products`, `categories`,
  `labTests`, `medications`, `shippings`, `verification`, and `geo`.
- The full error hierarchy: `AsterMDError` (abstract base), `TransportError`,
  and `ApiError` with `statusCode()` and `envelope()`, specialised into
  `AuthenticationError` (401), `NotFoundError` (404), `ValidationError` (422,
  with `fieldErrors()`), and `RateLimitError` (429, with `retryAfter()`).
- A pluggable `HttpClient` seam, with `FetchHttpClient` - the platform `fetch`
  plus an `AbortSignal` timeout - as the default. Any implementation can be
  injected in its place.
- Automatic JWT acquisition, caching, and renewal via `TokenManager`, with
  pluggable `TokenStore` backends (`InMemoryTokenStore`, `FileTokenStore`) and
  in-flight de-duplication of concurrent acquisition.
- Redacted debug logging. `debug: true` renders every request as a
  copy-pasteable curl command with bearer tokens, the OAuth2 client secret,
  PHI verification tokens, `patients/*` bodies, and file-upload bytes masked
  or dropped. Pass `debugRedact: false` to log verbatim. `DailyFileLogSink`
  provides one debug log file per day, with serialized writes and pruning
  after `debugRetentionDays` (default 7); supply your own `debugSink` to route
  entries elsewhere instead.
- `intakeSubmissions().uploadFile()` for single-request uploads of `file`-type
  answers, and the four multipart-upload methods -
  `initiateMultipartUpload()`, `uploadMultipartPart()`,
  `finishMultipartUpload()`, `abortMultipartUpload()` - for files too large
  for one request, plus `uploadLargeFile()`, which drives the whole multipart
  flow by streaming the file from disk one part at a time.
- `FileUpload`, an immutable file value object built with
  `FileUpload.fromPath()` or `FileUpload.fromContents()`, accepted by every
  endpoint that takes bytes rather than JSON.
- `ChannelDetail.from()`, a read model that flattens the deeply nested
  `channels().details()` envelope into a shape a view can render directly.
- `QueryParamCipher`, an AES-128-CBC codec for encrypted URL query-param
  tokens, byte-compatible with the PHP SDK's wire format while exposing an
  object-shaped `encrypt()` / `decrypt()` API.

### Requirements

- Node.js 22 or newer.

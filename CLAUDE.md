# CLAUDE.md - AsterMD Node SDK

Guidance for any AI agent (Claude Code, Copilot, etc.) working in this repo.
Read `docs/ARCHITECTURE.md` first - it is the source of truth for scope and
architecture.

---

## 1. What this package is

`@astermd-hq/sdk` - a slim, zero-dependency Node.js SDK wrapping the
order-flow portion of the AsterMD API (auth, sessions, intake, patients,
opportunities, treatments, and the read-only catalog). It is the Node
counterpart of the `astermd/sdk` Composer package, and it is _not_ a wrapper
for the entire API; treat it like Stripe's SDK - a curated public surface, not
exhaustive.

See `docs/INTEGRATION_GUIDE.md` for the endpoint list and
`docs/ARCHITECTURE.md` for the rationale.

## 2. Non-negotiable constraints

- **Node `>=22`.** Don't introduce syntax or platform APIs requiring newer.
- **Zero runtime dependencies.** No axios, no node-fetch, no undici - the
  default transport is the platform `fetch`. Any new runtime dependency
  requires explicit maintainer approval and breaks a stated feature of this
  package.
- **`strict` TypeScript**, plus `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess` - see `tsconfig.json`.
- **Dual ESM + CJS build.** `tsup` produces both; every relative import inside
  `src/` carries an explicit `.js` extension (required by `NodeNext` module
  resolution even though the source files are `.ts`).
- **Never bypass `npm run ci`.** It runs lint, format check, typecheck, tests,
  build, and `publint`, in that order. Don't call `vitest`, `tsc`, or `eslint`
  directly to "save time" - the gate is the gate.

## 3. Documentation style - TSDoc and comments

The project follows a Stripe-SDK-grade docblock convention. Every public class
and public method gets a rich TSDoc block.

- **Class-level**: multi-paragraph business description. What does this thing
  represent? What is it for? Where does it sit in the order flow? Include a
  usage example where it aids understanding (e.g. `AsterMDClient`,
  `FileTokenStore`).
- **Method-level**: 2–4 sentence prose description (what + when in the order
  flow + side effects on the server + what to inspect on the returned
  `Response`), plus:
  - `@param` on **every** parameter, even obvious scalars. For an object
    parameter built from known keys, document each key on the interface, not
    inline on the method. For a caller-supplied pass-through payload (e.g.
    `Patients.create(data)`), use `Record<string, unknown>` with the known
    top-level keys documented in prose, plus a pointer to the API reference in
    your AsterMD dashboard.
  - `@returns` always present, with a brief phrase describing what `data()`
    contains.
  - `@throws` for everything that can actually fire. Every resource method
    gets `{@link ApiError}` and `{@link TransportError}` at minimum (via
    `{@link AsterMDError}`). Add `{@link ValidationError}`,
    `{@link NotFoundError}`, etc. where relevant, and `{@link TypeError}` for
    any client-side argument validation.
- **Internal classes**: same standard. `Transport`, `TokenManager`,
  `FetchHttpClient`, `LoggingHttpClient`, `LogRedactor`, `DailyFileLogSink`,
  `FileTokenStore`, `UrlBuilder` all get full docblocks because contributors
  read them.
- **Private / unexported helpers**: skip TSDoc when the typed signature is
  self-documenting. Add it when the behaviour is non-obvious (a specific
  algorithm, a workaround for a known server quirk, a deliberate invariant).
- **Inline comments** stay exceptional - write them only when the _why_ is
  non-obvious. Never restate what the code already says.

Reference: `src/resource/sessions.ts` and `src/resource/doctors-networks.ts`
are the canonical examples - match their depth and shape for new resources.

## 4. Architectural rules

- Each resource class wraps one logical API surface and extends
  `AbstractResource`, depending only on `Transport`.
- `Transport` is the **only** place that touches HTTP, JSON, or `Request` /
  `Response` types, applies the bearer token, decodes the success envelope,
  and maps HTTP status codes to exceptions. Resources never see them.
- `TokenManager` is the only place that exchanges credentials for a JWT. It
  auto-retries once on 401, then raises `AuthenticationError`. The token is
  treated as expired 30 seconds before its stated expiry to avoid clock-skew
  races.
- `org_id` lives **inside the JWT**. The SDK must never accept or thread an
  `org_id` argument. If a future endpoint appears to need one, ask first.
- `AsterMDClient` accepts a bare host, not a URL, and always builds
  `/v1/{service}/{path}` itself. Never accept full URLs from consumers.
- Internal classes (`Transport`, `FetchHttpClient`, `UrlBuilder`,
  `TokenManager`, `LogRedactor`, `DailyFileLogSink`) are not designed for
  extension. Resource classes are extendable.
- Value objects (`Config`, `Token`, `Response`) call `Object.freeze(this)` in
  their constructors and expose only accessor methods.
- Enums are `as const` objects with a matching type alias, never TypeScript
  `enum` - see `src/enum/event.ts`. A bare string literal satisfies the type,
  which keeps the wire values exactly the PHP SDK's snake_case strings.
- **Argument style is a hybrid, not one rule for every method:**
  - One required scalar, no optionals → positional: `patients().view('p1')`.
  - Id + payload → positional pair: `opportunities().update('o1', { ... })`.
  - Three or more parameters, or any optional parameter → one options object:
    `sessions().create({ userAgent, clientIp })`.
- **The `Response` import gotcha.** The platform's global `Response` type
  (from `fetch`) and the SDK's own `Response` class share a name. Every file
  that needs both imports the SDK's as an alias:
  `import type { Response as ApiResponse } from '../response.js';` and refers
  to the platform type bare. Follow this pattern rather than fighting it with
  a differently named class.
- `TypeError` replaces PHP's `InvalidArgumentException` for client-side
  argument validation - never invent a custom exception type for this.
- Internal modules are not exported from `src/index.ts`. If a symbol isn't in
  the barrel, it isn't public API - don't reach around it from outside `src/`.
- **Debug logging is opt-in via `debug: true`.** `LoggingHttpClient` wraps the
  `HttpClient` BEFORE it reaches `TokenManager`, so the credential exchange is
  logged too. Redaction via `LogRedactor` is **on by default**;
  `debugRedact: false` disables it.

The nine deliberate divergences from the PHP SDK (fresh `Request` per attempt,
async `TokenStore`, and so on) are documented in full in
`docs/ARCHITECTURE.md` - do not restate them here, and check that doc before
assuming PHP behaviour carries over.

## 5. Node-specific rules

These are the traps this port actually hit - read them before touching
`Transport`, `TokenManager`, or the logging path.

- **A fresh `Request` is built per dispatch attempt.** A `fetch` request body
  is a single-use stream; replaying an already-sent `Request` on a 401 retry
  would transmit an empty body silently, not the original one. Never cache
  and reuse a `Request` object across attempts.
- **`TokenStore` is asynchronous.** Every method (`get`, `put`, `clear`)
  returns a `Promise`, so a consumer can back it with a remote store (Redis,
  a database) and not only local memory or the filesystem.
- **Token acquisition is de-duplicated** by an in-flight promise held on
  `TokenManager`, cleared in a `finally` block so a failed exchange is never
  cached and the next call retries cleanly.
- **The debug sink serializes its writes** through a promise chain and
  **swallows its own I/O errors.** Logging must never fail an API call -
  a disk-full sink is a logging problem, not a transport failure.
- **`QueryParamCipher`'s wire format is fixed by PHP compatibility.** It keeps
  the PHP SDK's `[{key, value}]` array shape on the wire even though its
  TypeScript API is a plain `Record<string, string>`. Do not "clean up" the
  wire format - a change there breaks interoperability with the PHP SDK and
  the token-producing service.

## 6. Testing rules

- Every public method on every resource has a unit test.
- Tests use `MockHttpClient` (via `test/support/harness.ts`'s `makeHarness()`
  or `makeClient()`) - **never make a real HTTP call.**
- Each resource test asserts: URL (host + `/v1/{service}/{path}`), HTTP
  method, headers (`Authorization: Bearer …`, `Content-Type`, optional
  `x-phi-verification-token`), and request body shape - parsed and compared as
  an object, not a raw string.
- `TokenManager` tests cover: lazy acquisition, expiry pre-buffer, single 401
  auto-retry, second-401 → `AuthenticationError`, and concurrent-call dedupe.
- `Transport` tests cover envelope decoding and one assertion per
  HTTP-status-to-exception mapping.
- `LogRedactor` tests cover every sensitive header and field, and that
  `patients/*` and `identity-verify` bodies are dropped.
- `DailyFileLogSink` tests cover dated filenames, appending, retention
  pruning, and that unrelated files are never deleted.
- `UrlBuilder` tests cover the default host and a custom host override.
- `FileTokenStore` tests cover round-tripping a token and the store's file
  permissions.
- `QueryParamCipher` tests cover a round trip and byte-for-byte compatibility
  with a fixture produced by the PHP SDK.
- Where a method validates client-side before sending, assert **both**
  branches: the `TypeError` it throws, and that a valid payload still reaches
  the transport unmodified apart from documented normalisation.

CI gate, in order: `eslint` → `prettier --check` → `tsc --noEmit` → `vitest
run` → `tsup` (build) → `publint`. Any failure blocks release.

## 7. Security & privacy

- Never log the client secret, access token, OTP codes, or PHI fields.
  `LogRedactor` enforces this for debug output; keep it that way.
- Never log full request/response bodies for `patients/*` endpoints or any
  endpoint carrying `x-phi-verification-token` (including `identity-verify`).
- **Never hardcode a key, secret, token, or credential in source** - not even
  as a default or a placeholder "for now". Cryptographic keys are
  caller-supplied parameters.
- Do not embed real credentials in fixtures or tests - use obviously fake
  placeholders.
- Do not document internals of token construction, hashing, or datastore
  layout. The SDK exposes the public _interface_ only.

## 8. Public-repository hygiene

This repository is public. Nothing in a tracked file may reveal internal
infrastructure, tooling, or roadmap:

- No internal hostnames, bucket names, datastore or message-broker names, or
  named third-party vendors.
- No non-production environments. Every host and URL in docs and code is
  production.
- No references to internal issue trackers, private repositories, or internal
  specification files. Point readers at **the API reference in your AsterMD
  dashboard** instead.
- No "pending", "not yet implemented", or "coming soon" notes. If a capability
  is not shipped, the public docs are silent about it.
- All support, security, and licensing enquiries go to **info@astermd.com**.

## 9. Workflow expectations

- For any non-trivial change, read the doc covering the area first
  (`docs/ARCHITECTURE.md` or `docs/INTEGRATION_GUIDE.md`); if it is stale,
  update it in the same change.
- Add a `CHANGELOG.md` entry under `## [Unreleased]` for user-visible changes.
- Run `npm run ci` before declaring work done. Don't claim a fix without the
  green output to back it up.
- Default to _no_ new files. Prefer editing existing ones. Don't create
  speculative abstractions - the package is intentionally small.

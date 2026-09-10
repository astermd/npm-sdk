# AsterMD Node.js SDK — Integration Guide

This is the handoff document for engineers (or AI sessions) building an
application on top of the `@astermd-hq/sdk` npm package. It assumes you have a
working Node.js project and an AsterMD `client_id` + `client_secret`.

If you only want to install and call one endpoint, the project `README.md` is
shorter and probably enough. Use this document when you are wiring the SDK into
a real flow.

---

## Table of contents

1. [Mental model](#1-mental-model)
2. [Install](#2-install)
3. [Client construction](#3-client-construction)
4. [End-to-end order flow](#4-end-to-end-order-flow)
5. [Resources reference](#5-resources-reference)
6. [Auth lifecycle](#6-auth-lifecycle)
7. [Error handling](#7-error-handling)
8. [File uploads](#8-file-uploads)
9. [Framework recipes](#9-framework-recipes)
10. [Custom transport (BYO HttpClient)](#10-custom-transport-byo-httpclient)
11. [Debugging — copy-paste-able curl logs](#11-debugging--copy-paste-able-curl-logs)
12. [Assets](#12-assets)

---

## 1. Mental model

The SDK is a thin, typed wrapper around the AsterMD public REST API.

```
your app
  └── AsterMDClient
        ├── .sessions()         .intakeSubmissions()    .carts()           .teleforms()
        ├── .patients()         .opportunities()   .treatments()
        ├── .doctorsNetworks()  .channels()
        └── catalog: .products() / .categories() / .labTests()
                     .medications() / .shippings()
        + .verification()  .geo()
```

Every resource method returns a `Response<T>`:

- `.statusCode(): number`
- `.data(): T` — the `data` field from the envelope, decoded JSON. Defaults to
  `Record<string, unknown>`; pass a type argument to the _resource method_ (not
  to `data()`) when you want compiler help, declaring the shape yourself from
  the API reference in your AsterMD dashboard.
- `.meta(): Readonly<Record<string, unknown>>` — pagination, totals, etc.
- `.message(): string` — server-supplied human message
- `.raw(): string` — the raw response body (for logging / debugging)

`data()` is NOT a typed DTO — the SDK ships no per-endpoint response types,
because the server owns those shapes, not the SDK. You read fields directly,
and where you want type-checked access, declare the interface yourself and
pass it as the resource method's type argument:

```ts
// Declare the response shape you rely on, from the API reference in your
// AsterMD dashboard — the SDK does not ship response types.
interface PatientRecord {
  id: string;
  email: string;
}

const { id, email } = (await client.patients().view<PatientRecord>('p-1')).data();
```

The SDK does NOT handle:

- Eligibility checks (your app decides who's eligible)
- Payment processing (your payment provider runs outside the SDK)
- Server-side event forwarding (handled by AsterMD; no SDK exposure)

---

## 2. Install

```bash
npm install @astermd-hq/sdk
```

Requirements:

- Node `>=22`

Zero runtime dependencies — the platform `fetch`, `node:crypto`, and `node:fs`
only. No Express, no framework coupling; the client works the same inside any
of them or none.

---

## 3. Client construction

```ts
import { AsterMDClient } from '@astermd-hq/sdk';

const client = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
});
```

Optional constructor fields (`AsterMDClientOptions`):

| Field                | Type         | Default              | Purpose                                                     |
| -------------------- | ------------ | -------------------- | ----------------------------------------------------------- |
| `baseHost`           | `string`     | `api.astermd.com`    | Host only; SDK appends `/v1/{service}/{path}`               |
| `httpClient`         | `HttpClient` | `FetchHttpClient`    | Swap the transport (see §10)                                |
| `tokenStore`         | `TokenStore` | `InMemoryTokenStore` | Token cache (see §6)                                        |
| `timeoutSeconds`     | `number`     | `10`                 | Per-request timeout, applied via `AbortSignal`              |
| `debug`              | `boolean`    | `false`              | Master debug-logging toggle (see §11)                       |
| `debugFile`          | `string`     | —                    | Base path for daily log files                               |
| `debugSink`          | `DebugSink`  | —                    | Receive formatted entries yourself instead of writing files |
| `debugTimezone`      | `string`     | `UTC`                | IANA time zone for log timestamps and filenames             |
| `debugRedact`        | `boolean`    | `true`               | Mask credentials and PHI in debug output                    |
| `debugRetentionDays` | `number`     | `7`                  | Days of daily log files to keep; `0` keeps everything       |

The constructor validates eagerly and throws `TypeError` if `clientId` or
`clientSecret` is empty, if `baseHost` carries a scheme or a path, if
`timeoutSeconds` is below `1`, or if `debug` is `true` with neither `debugFile`
nor `debugSink` supplied.

Construct the client **once**, at module scope, and share it across requests —
see §9 for what that looks like in Express, Fastify, and Next.js. A client
built per request throws away the cached bearer token and pays for a fresh
credential exchange every time.

---

## 4. End-to-end order flow

This is the choreography the SDK is designed to support. Cache the session
UUID (cookie / your own server-side session store / database) so you can
resume from any step.

```ts
import { AsterMDClient, Event } from '@astermd-hq/sdk';

const client = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
});
```

### Step 1 — Start a session (page view)

```ts
const { session } = (await client.sessions().create<{ session: string }>()).data();
// Server logs an implicit `visit_page` event. No payload required.
// Persist `session` for the rest of the journey.

// Forward the visitor's browser User-Agent AND IP so the session is attributed
// to their device/geo, not this server-side Node process. The SDK runs
// server-to-server, so only your app knows the real values — read them from
// the incoming request.
const { session: attributedSession } = (
  await client.sessions().create<{ session: string }>({
    userAgent: request.headers['user-agent'],
    clientIp: request.ip,
  })
).data();

// Optional payload — send any additional creation hints the server accepts.
// await client.sessions().create<{ session: string }>({
//   data: { test: true },
//   userAgent: request.headers['user-agent'],
//   clientIp: request.ip,
// });
```

### Step 2 — Pre-qualifying (identity check, basic questions)

Before recording answers, validate what the prospect typed. These checks are
independent of the session and store nothing — the verdict is yours to act on.

```ts
import { IdentityCheck } from '@astermd-hq/sdk';

// Address field: suggestions as they type, then one validation on the chosen line.
const suggestions = (await client.verification().autofillAddress('123 Main St, San')).data();
const address = (await client.verification().verifyAddress('123 Main St, San Francisco, CA 94105')).data();

// Email: `unknown` means inconclusive (provider rate-limited), not a failure — let them through.
// Declare the response shape you rely on, from the API reference in your
// AsterMD dashboard — the SDK does not ship response types.
interface EmailVerification {
  result: string;
}

const emailResult = (await client.verification().verifyEmail<EmailVerification>('jane@example.com')).data();

if (emailResult.result === 'invalid') {
  // ask for a different address
}

// Identity: the enum sets the request's `slug` and dictates which fields are required.
// Declare the response shape you rely on, from the API reference in your
// AsterMD dashboard — the SDK does not ship response types.
interface IdentityVerification {
  valid: boolean | null;
  reasons: { code: string; message: string }[];
}

const identity = (
  await client.verification().verifyIdentity<IdentityVerification>(IdentityCheck.DobVerify, {
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '+15550001234',
    dob: '1990-01-15',
  })
).data();

if (identity.valid === false) {
  for (const reason of identity.reasons) {
    // { code: 'dob_mismatch', message: '…' }
  }
}
```

Then record the answers themselves:

```ts
const teleformId = '6a01a937449da4a6bd492a8a'; // fetched from your config / channel

// On form start — `data` is a list of field objects (id / name / label / type / value)
await client.intakeSubmissions().create({
  session,
  event: Event.PreQualifyingInitiated,
  teleformId,
  data: [{ id: 'name-2345', name: 'name', label: 'Full name', type: 'text', value: [{ value: 'Jane' }] }],
});

// As the user advances (multi-step) — send full accumulated data every time
await client.intakeSubmissions().update({
  session,
  event: Event.PreQualifyingInProgress,
  teleformId,
  data: [
    { id: 'name-2345', name: 'name', label: 'Full name', type: 'text', value: [{ value: 'Jane' }] },
    {
      id: 'dob-2345',
      name: 'dob',
      label: 'Date of birth',
      type: 'date',
      value: [{ value: '1990-01-15' }],
    },
  ],
});

// On completion
await client.intakeSubmissions().update({
  session,
  event: Event.PreQualifyingCompleted,
  teleformId,
  data: [/* full list of field objects */],
});
```

### Step 3 — Build the cart

```ts
// After pre-qualifying, build the cart from selected products.
// Each item identifies a product and quantity; the event and channel_id are
// derived server-side.
await client.carts().create({
  session,
  items: [
    { product_id: '6a1c28f05f315cee0e41c301', name: 'Semaglutide', qty: 2 },
    { product_id: '6a1c28f05f315cee0e41c357', name: 'Tirzepatide', qty: 3 },
  ],
});

// Later — user changes their mind (send the full replacement list)
await client.carts().update({
  session,
  items: [{ product_id: '6a1c28f05f315cee0e41c301', name: 'Semaglutide', qty: 1 }],
});
```

### Step 4 — Eligibility (handled by your app, not the SDK)

```ts
if (!yourApp.isEligible(prequalAnswers)) {
  // route user to the disqualified flow; you decide.
  return;
}
```

### Step 5 — Create the opportunity, attaching the session

```ts
// Declare the response shape you rely on, from the API reference in your
// AsterMD dashboard — the SDK does not ship response types.
interface CreatedOpportunity {
  id: string;
}

const opportunity = (
  await client.opportunities().create<CreatedOpportunity>({
    first_name: 'Jane',
    email: 'jane@example.com',
    sessions: [session],
    // … other opportunity fields
  })
).data();

const opportunityId = opportunity.id;
```

### Step 6 — Intake (the main clinical questionnaire)

Same shape as pre-qualifying, different events:

```ts
const intakeTeleformId = '5b03c428b9aa12f56dec3091';

await client.intakeSubmissions().create({
  session,
  event: Event.IntakeInitiated,
  teleformId: intakeTeleformId,
  data: [],
});

// during the form
await client.intakeSubmissions().update({
  session,
  event: Event.IntakeInProgress,
  teleformId: intakeTeleformId,
  data: accumulatedAnswers,
});

// on submit
await client.intakeSubmissions().update({
  session,
  event: Event.IntakeCompleted,
  teleformId: intakeTeleformId,
  data: allAnswers,
});
```

### Step 7 — Create the patient and submit health information (PHI)

```ts
// Declare the response shape you rely on, from the API reference in your
// AsterMD dashboard — the SDK does not ship response types.
interface CreatedPatient {
  id: string;
}

const prospect = (
  await client.patients().create<CreatedPatient>({
    first_name: 'Jane',
    email: 'jane@example.com',
    phone_number: '5551234567',
    // … remaining patient fields per the API reference in your AsterMD dashboard
  })
).data();

const prospectId = prospect.id;
```

Some flows require an OTP'd PHI block before clinical review:

```ts
await client.patients().submitHealthInformation({
  data: {
    patient_id: prospectId,
    answers: clinicalAnswers,
  },
});

// If your flow uses PHI OTP verification, you receive a verification token
// out-of-band, then submit again with it (when re-submitting):
await client.patients().submitHealthInformation({
  data: payload,
  phiVerificationToken: 'tok-from-otp-step',
});
```

PHI OTP verification:

```ts
await client.patients().verifyHealthInformationOtp({
  patient_id: prospectId,
  otp: '123456',
});
```

### Step 8 — Doctor's-network case creation

When the order requires routing to an external clinical network:

```ts
await client.doctorsNetworks().sync({
  session_id: session,
  network: 'your-network-slug', // optional; values are supplied by AsterMD
  opportunity_id: opportunityId, // OR provide user_info below
  products: [{ product_id: 'p1' }],
});

// Alternative: skip opportunity_id and provide minimal user_info
await client.doctorsNetworks().sync({
  session_id: session,
  user_info: {
    first_name: 'Jane',
    email: 'jane@example.com',
    // optional overrides:
    last_name: 'Doe',
    phone_number: '5551234567',
    date_of_birth: '1990-01-15',
    address: {
      address: '123 Main St',
      zip_code: '10001',
      city_name: 'New York',
      state_name: 'NY',
    },
  },
  products: [{ product_id: 'p1', variant_id: 'v1' }],
});
```

The SDK enforces the "opportunity_id OR (first_name + email)" precondition
**client-side** and throws `TypeError` before sending the request. The
deprecated `emit_opportunity` field is silently stripped.

### Step 9 — Payment (external)

```
your app → your payment provider → settlement webhook
```

The SDK is uninvolved here.

### Step 10 — Create the treatment (= order)

Once settlement confirms:

```ts
const treatment = (
  await client.treatments().create({
    external_order_id: 'EXT-12345',
    channel_id: '…',
    integration_id: '…',
    patient: { id: prospectId },
    product: { id: 'p1', variant_id: 'v1' },
    shipping_address: {/* … */},
  })
).data();
```

> **Alternative when the order originates in an external CRM:** if your CRM is
> the source of truth for the order record and you only need AsterMD to be
> aware of it, call `client.treatments().sync({ session, orderIds: ['28618'] })`
> instead of `treatments().create(...)`.

### Step 11 — Resume from any step

A cached `session` UUID is the only thing you need. Every method that touches
a session accepts it as an argument; nothing is held client-side.

```ts
// Days later — pick up where the user left off
await client.intakeSubmissions().update({
  session: cachedSessionUuid,
  event: Event.IntakeInProgress,
  teleformId,
  data: previouslySavedAnswers,
});
```

---

## 5. Resources reference

All methods return `Response<T>`, where `T` defaults to `Record<string, unknown>`
and can be supplied as a type argument on the method itself (not on `.data()`).

### `sessions()`

| Method                                                                          | HTTP   | Path                                    |
| ------------------------------------------------------------------------------- | ------ | --------------------------------------- |
| `create(options?: SessionCreateOptions): Promise<Response<T>>`                  | POST   | `/v1/sales/sessions/create`             |
| `view(options: SessionViewOptions): Promise<Response<T>>`                       | GET    | `/v1/sales/sessions/view?session_ids=…` |
| `update(session: string, data?: Record<string, unknown>): Promise<Response<T>>` | PUT    | `/v1/sales/sessions/update/{id}`        |
| `delete(session: string): Promise<Response<T>>`                                 | DELETE | `/v1/sales/sessions/delete/{id}`        |

`SessionCreateOptions` is `{ data?, userAgent?, clientIp? }` — `userAgent` and
`clientIp` are forwarded as the `User-Agent` and `X-Original-Client-Ip`
headers. `SessionViewOptions` is `{ sessions: string[], tz? }` — the
identifiers are comma-joined into the `session_ids` query parameter, and
several can be fetched in one round-trip.

### `intakeSubmissions()`

| Method                                                                             | HTTP | Path                                                                                |
| ---------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| `view(options: IntakeViewOptions): Promise<Response<T>>`                           | GET  | `/v1/sales/intake-submissions/view/{id}`                                            |
| `create(options: IntakeWriteOptions): Promise<Response<T>>`                        | POST | `/v1/sales/intake-submissions/create`                                               |
| `update(options: IntakeWriteOptions): Promise<Response<T>>`                        | PUT  | `/v1/sales/intake-submissions/update/{session}`                                     |
| `uploadFile(options: UploadFileOptions): Promise<Response<T>>`                     | POST | `/v1/sales/intake-submissions/upload-file/{session_id}`                             |
| `initiateMultipartUpload(options: InitiateMultipartOptions): Promise<Response<T>>` | POST | `/v1/sales/intake-submissions/upload-file-multipart/initiate/{session_id}`          |
| `uploadMultipartPart(options: UploadPartOptions): Promise<Response<T>>`            | POST | `/v1/sales/intake-submissions/upload-file-multipart/part/{upload_id}?part_number=…` |
| `finishMultipartUpload(options: FinishMultipartOptions): Promise<Response<T>>`     | POST | `/v1/sales/intake-submissions/upload-file-multipart/finish/{upload_id}`             |
| `abortMultipartUpload(uploadId: string): Promise<Response<T>>`                     | POST | `/v1/sales/intake-submissions/upload-file-multipart/abort/{upload_id}`              |
| `uploadLargeFile(options: UploadLargeFileOptions): Promise<Response<T>>`           | —    | drives the four multipart calls above                                               |

`IntakeViewOptions` is `{ id, teleformId }`; `id` identifies the submission
itself, and `teleformId` is required alongside it because the server resolves
field definitions against that form. `IntakeWriteOptions` is `{ session,
event, teleformId, data, progress? }`. `data` is a list of field objects
(`{ id, name, label, type, value[] }`). `progress` is optional for multi-page
forms. The stored `data` and the server-derived `contact` block are **PHI** —
do not log the response body.

`Event` values:

- `Event.PreQualifyingInitiated` / `PreQualifyingInProgress` / `PreQualifyingCompleted`
- `Event.IntakeInitiated` / `IntakeInProgress` / `IntakeCompleted`

See §8 for the upload methods in detail.

### `carts()`

| Method                                                    | HTTP | Path                               |
| --------------------------------------------------------- | ---- | ---------------------------------- |
| `create(options: CartWriteOptions): Promise<Response<T>>` | POST | `/v1/sales/carts/create`           |
| `update(options: CartWriteOptions): Promise<Response<T>>` | PUT  | `/v1/sales/carts/update/{session}` |

`CartWriteOptions` is `{ session, items }`. `items` is the cart's _whole_
contents, not a delta. Each entry identifies a product and quantity, and a
variant where the product has them — see the API reference in your AsterMD
dashboard for the exact fields. The journey event and `channel_id` are derived
server-side, so the SDK does not send them.

### `checkoutEvents()`

| Method                                                                          | HTTP | Path                                            |
| ------------------------------------------------------------------------------- | ---- | ----------------------------------------------- |
| `create(session: string, data?: Record<string, unknown>): Promise<Response<T>>` | POST | `/v1/sales/checkout-events/create`              |
| `update(options: CheckoutEventUpdateOptions): Promise<Response<T>>`             | PUT  | `/v1/sales/checkout-events/update/{session_id}` |

`create()` always records `CheckoutEvent.CheckoutVisited` and defaults
`currency` to `USD` when the payload does not supply one. `update()`'s options
are `{ session, event, data? }`; the payload can never override `event`.

### `teleforms()`

| Method                                                       | HTTP | Path                                                  | Notes                                           |
| ------------------------------------------------------------ | ---- | ----------------------------------------------------- | ----------------------------------------------- |
| `viewByIdentifier(identifier: string): Promise<Response<T>>` | GET  | `/v1/sales/teleforms/view-url/{form_json_identifier}` | Look up a teleform by its configured identifier |
| `view(id: string): Promise<Response<T>>`                     | GET  | `/v1/sales/teleforms/view/{id}`                       |                                                 |

### `patients()`

| Method                                                                                   | HTTP  | Path                                                     |
| ---------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------- |
| `create(data: Record<string, unknown>): Promise<Response<T>>`                            | POST  | `/v1/sales/patients/create`                              |
| `view(id: string): Promise<Response<T>>`                                                 | GET   | `/v1/sales/patients/view/{id}`                           |
| `update(id: string, data: Record<string, unknown>): Promise<Response<T>>`                | PUT   | `/v1/sales/patients/update/{id}`                         |
| `status(id: string, status: string): Promise<Response<T>>`                               | PATCH | `/v1/sales/patients/status/{id}`                         |
| `submitHealthInformation(options: SubmitHealthInformationOptions): Promise<Response<T>>` | POST  | `/v1/sales/patients/health-information`                  |
| `verifyHealthInformationOtp(data: Record<string, unknown>): Promise<Response<T>>`        | POST  | `/v1/sales/patients/health-information/otp-verification` |

`submitHealthInformation`'s options are `{ data, phiVerificationToken? }`; the
token, when supplied, is sent as the `x-phi-verification-token` header. Neither
the request nor the response body of any `patients/*` call is ever written to
a debug log.

### `opportunities()`

| Method                                                                    | HTTP  | Path                                  | Notes                               |
| ------------------------------------------------------------------------- | ----- | ------------------------------------- | ----------------------------------- |
| `create(data: Record<string, unknown>): Promise<Response<T>>`             | POST  | `/v1/sales/opportunities/create`      | Accepts `sessions` (array of UUIDs) |
| `view(id: string): Promise<Response<T>>`                                  | GET   | `/v1/sales/opportunities/view/{id}`   |                                     |
| `update(id: string, data: Record<string, unknown>): Promise<Response<T>>` | PUT   | `/v1/sales/opportunities/update/{id}` |                                     |
| `status(id: string, status: string): Promise<Response<T>>`                | PATCH | `/v1/sales/opportunities/status/{id}` | Sends `{ opportunity_status: … }`   |

### `treatments()`

| Method                                                        | HTTP | Path                             |
| ------------------------------------------------------------- | ---- | -------------------------------- |
| `create(data: Record<string, unknown>): Promise<Response<T>>` | POST | `/v1/sales/treatments/create`    |
| `view(id: string): Promise<Response<T>>`                      | GET  | `/v1/sales/treatments/view/{id}` |
| `list(query?: QueryParams): Promise<Response<T>>`             | GET  | `/v1/sales/treatments/list`      |
| `sync(options: TreatmentSyncOptions): Promise<Response<T>>`   | POST | `/v1/sales/treatments/sync`      |

`TreatmentSyncOptions` is `{ session, orderIds, utmSource?, userAgent? }`. Use
`sync()` to push an order settled in an external CRM into AsterMD after
settlement happens outside the SDK.

### `doctorsNetworks()`

| Method                                                         | HTTP | Path                              |
| -------------------------------------------------------------- | ---- | --------------------------------- |
| `sync(payload: Record<string, unknown>): Promise<Response<T>>` | POST | `/v1/sales/doctors-networks/sync` |

Client-side: strips `emit_opportunity`; throws `TypeError` unless the payload
carries either a non-empty `opportunity_id` string, or a `user_info` object
with non-empty `first_name` and `email` strings.

### `channels()`

| Method                                               | HTTP | Path                                        |
| ---------------------------------------------------- | ---- | ------------------------------------------- |
| `view(id: string): Promise<Response<T>>`             | GET  | `/v1/sales/channels/view/{id}`              |
| `details(id: string): Promise<Response<T>>`          | GET  | `/v1/sales/channels/detail/{id}`            |
| `assignedProducts(id: string): Promise<Response<T>>` | GET  | `/v1/sales/channels/assigned-products/{id}` |

> `details()` returns the channel's expanded record (channel + embedded
> integrations / theming / related references resolved server-side) in one
> round-trip — use it when you want everything `view()` returns plus the nested
> associations. Note the URL path is `detail` (singular) by server convention;
> the SDK method is `details()`. Pass `.data()` from this call through
> `ChannelDetail.from()` to flatten the deeply nested envelope into a shape a
> view can render directly.

### Catalog (read-only)

| Resource        | `list(query?)`               | `view(id)`                       |
| --------------- | ---------------------------- | -------------------------------- |
| `products()`    | `/v1/sales/products/list`    | `/v1/sales/products/view/{id}`   |
| `categories()`  | `/v1/sales/categories/list`  | `/v1/sales/categories/view/{id}` |
| `labTests()`    | `/v1/sales/lab-tests/list`   | `/v1/sales/lab-tests/view/{id}`  |
| `medications()` | `/v1/sales/medications/list` | — (list only)                    |
| `shippings()`   | `/v1/sales/shippings/list`   | `/v1/sales/shippings/view/{id}`  |

Every `list()` method accepts a `QueryParams` object (`Record<string, string |
number | boolean>`) that is encoded as the query string, e.g. `{ page: 2,
limit: 50 }` → `?page=2&limit=50`.

### `verification()`

| Method                                                             | HTTP | Path                                       |
| ------------------------------------------------------------------ | ---- | ------------------------------------------ |
| `autofillAddress(search: string): Promise<Response<T>>`            | GET  | `/v1/platform/extensions/address-autofill` |
| `verifyAddress(address: string): Promise<Response<T>>`             | GET  | `/v1/platform/extensions/address-verify`   |
| `verifyEmail(email: string): Promise<Response<T>>`                 | GET  | `/v1/platform/extensions/email-verify`     |
| `verifyIdentity(check: IdentityCheck, data): Promise<Response<T>>` | POST | `/v1/platform/extensions/identity-verify`  |

`verifyIdentity()` takes an `IdentityCheck` value that sets the request's
`slug` and determines which fields `data` must carry — see the API reference in
your AsterMD dashboard for the definitive set per check. The result is
provider-agnostic apart from `raw` — read `valid` for the verdict (`null` when
the provider answered but returned nothing decisive), `basis` for which rule
decided it, `score`/`threshold` for scored checks, and `reasons` for coded
explanatory signals.

### `geo()`

| Method                                        | HTTP | Path                                    |
| --------------------------------------------- | ---- | --------------------------------------- |
| `info(ip: string): Promise<Response<T>>`      | GET  | `/v1/platform/extensions/geo-info`      |
| `blocklist(ip: string): Promise<Response<T>>` | GET  | `/v1/platform/extensions/geo-blocklist` |

Both return the provider's hyphenated keys verbatim (`region-code`,
`is-listed`, …).

> Every method in these two sections requires the matching integration to be
> active for your organization; when it is not, the call fails with `ApiError`
> (HTTP 403). Invalid input on these endpoints is reported as HTTP 400, which
> also surfaces as `ApiError` rather than `ValidationError` — see
> [§7 Error handling](#7-error-handling). Redaction never covers the request
> URL (see §11), so a debug entry for any of these calls, or for
> `verification()`'s address/email checks, contains the address, email, or IP
> that was checked.

---

## 6. Auth lifecycle

The SDK trades `client_id` + `client_secret` for a short-lived JWT at
`POST /v1/auth/api-credentials/token`. It manages the token automatically.

What you don't have to think about:

- **First call:** SDK lazily acquires the token.
- **Subsequent calls:** SDK reuses the cached token.
- **30-second pre-buffer:** SDK treats the token as expired 30s before its
  stated `access_token_expiry` to avoid clock-skew races.
- **Concurrent acquisition:** if several calls miss the cache at once, they
  share one in-flight token exchange rather than firing one each.
- **401 in flight:** SDK re-authenticates once and retries the original
  request. If the second attempt also fails, you get `AuthenticationError`.
- **`org_id`:** The org is encoded inside the JWT by the server. You never
  thread it through requests.

### Token storage

By default the token lives in an `InMemoryTokenStore` — the right choice for a
long-running Node server (Express, Fastify, a worker process): one credential
exchange serves every request until the token is close to expiry. That is a
different starting point than PHP, where every request is a fresh
share-nothing process and the in-memory default re-authenticates constantly;
in Node, a singleton client with the in-memory store is often all you need.

A shared store still matters when your deployment does _not_ look like one
long-running process — multiple server instances behind a load balancer,
serverless functions, or worker processes that don't share memory. The options,
in recommended order:

| Option        | Class                          | Requires                        | Notes                                                                          |
| ------------- | ------------------------------ | ------------------------------- | ------------------------------------------------------------------------------ |
| **Redis**     | write your own (see below)     | A Redis server + client library | Recommended for multi-instance deployments. TTL-native, no filesystem exposure |
| **File**      | `FileTokenStore` (built-in)    | Nothing                         | Works anywhere a filesystem is shared across processes                         |
| **In memory** | `InMemoryTokenStore` (default) | Nothing                         | Right for a single long-running process                                        |

---

#### Option 1 — Redis (recommended for multi-instance deployments)

Redis is the safest choice for a fleet: the token never touches the
filesystem, access is controlled by Redis auth and network rules, and TTL
expiry is handled natively. Implement `TokenStore` — three async methods —
against whichever Redis client your app already uses:

```ts
import { Token, type TokenStore } from '@astermd-hq/sdk';

class RedisTokenStore implements TokenStore {
  constructor(
    private readonly redis: MyRedisClient,
    private readonly key = 'astermd:jwt',
  ) {}

  async get(): Promise<Token | null> {
    const raw = await this.redis.get(this.key);

    if (raw === null) {
      return null;
    }

    try {
      const { value, expiresAt } = JSON.parse(raw) as { value: string; expiresAt: string };
      return new Token(value, new Date(expiresAt));
    } catch {
      return null;
    }
  }

  async put(token: Token): Promise<void> {
    const ttlSeconds = Math.max(1, Math.floor((token.expiresAt().getTime() - Date.now()) / 1000));

    await this.redis.set(
      this.key,
      JSON.stringify({ value: token.value(), expiresAt: token.expiresAt().toISOString() }),
      { EX: ttlSeconds },
    );
  }

  async clear(): Promise<void> {
    await this.redis.del(this.key);
  }
}
```

```ts
const client = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
  tokenStore: new RedisTokenStore(redis),
});
```

#### Option 2 — File cache (built-in, no dependencies)

`FileTokenStore` ships with the SDK. Use it when several processes on the same
machine share a filesystem but you would rather not add Redis.

```ts
import { AsterMDClient, FileTokenStore } from '@astermd-hq/sdk';

const client = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
  tokenStore: new FileTokenStore('/var/cache/astermd/token.json'),
});
```

**The file must not be publicly accessible.** The SDK writes it `0o600` — owner
read/write only — automatically, but you also need to ensure your server will
not serve it as a static file:

- **Preferred layout**: keep the path outside anything a web server or static
  file handler could reach — a dedicated cache directory well away from any
  public or `static/` root.
- **If you must stay near a served directory**: block it in your server or
  proxy config.

Writes are atomic (temp file + rename), so a concurrent reader never observes
a partially written token. A missing, unreadable, or corrupt file is treated as
"no token" rather than raising — a damaged cache costs one extra credential
exchange instead of breaking a request.

#### Writing your own store

Implement the three-method `TokenStore` interface — `get()`, `put(token)`,
`clear()`, all asynchronous — against anything: a database, a KV service, your
platform's built-in secret cache. `TokenManager` calls `isExpired()` on
whatever `get()` returns, so your store's only job is faithful storage and
retrieval; expiry logic stays in the SDK.

A stored token is a live credential. Whatever backs your store must be
protected at least as well as the client secret itself.

---

## 7. Error handling

All SDK errors extend `AsterMDError`.

```ts
import {
  AsterMDError,
  TransportError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ApiError,
} from '@astermd-hq/sdk';

try {
  const response = await client.patients().create(payload);
} catch (error) {
  if (error instanceof ValidationError) {
    // 422 — fix and retry
    for (const [field, messages] of Object.entries(error.fieldErrors())) {
      // messages is string[]
    }
  } else if (error instanceof NotFoundError) {
    // 404
  } else if (error instanceof RateLimitError) {
    await new Promise(resolve => setTimeout(resolve, (error.retryAfter() ?? 5) * 1000));
    // retry…
  } else if (error instanceof AuthenticationError) {
    // Re-auth failed; check that clientId/clientSecret are correct.
  } else if (error instanceof TransportError) {
    // No HTTP response — DNS / TLS / timeout. Retry with backoff.
  } else if (error instanceof ApiError) {
    // Other 4xx/5xx. Inspect error.statusCode() and error.envelope().
  } else if (error instanceof AsterMDError) {
    // Unreachable today — kept as a safety net if the hierarchy grows.
  } else {
    throw error;
  }
}
```

Hierarchy:

```
AsterMDError (abstract)
├── TransportError
└── ApiError                ← carries statusCode() + envelope()
    ├── AuthenticationError (401)
    ├── NotFoundError       (404)
    ├── ValidationError     (422) ← + fieldErrors()
    └── RateLimitError      (429) ← + retryAfter()
```

`TransportError` is intentionally NOT an `ApiError` — no HTTP response was ever
received, so there is no `statusCode()` to inspect. It, along with
`RateLimitError`, is the pair worth treating as retryable; the rest are
terminal for the request that produced them.

Only HTTP 422 becomes a `ValidationError`. The `verification()` and `geo()`
endpoints report invalid input as HTTP 400 and an inactive integration as HTTP
403, so both arrive as a plain `ApiError` — check `error.statusCode()` to tell
them apart.

---

## 8. File uploads

`intakeSubmissions()` accepts bytes as well as JSON, for `file`-type answers on
a teleform. A `file`-type field's bytes are uploaded **before** the submission
that references them: the upload endpoints do not touch the submission
itself, each returns a `{ path, name, mime_type }` reference, and you attach
that reference to the matching entry of that field's `value` list in the
`data` you pass to `create()` or `update()`.

Files are handed to the SDK as a `FileUpload`:

```ts
import { FileUpload } from '@astermd-hq/sdk';

// From a path — file name and MIME type are derived from it. Async: reads the
// whole file into memory.
const upload = await FileUpload.fromPath('/var/uploads/id-front.jpg');

// From bytes already in memory — the file name is required. Synchronous.
const inMemory = FileUpload.fromContents(bytes, 'id-front.jpg', { mimeType: 'image/jpeg' });
```

**Small files — one request.** `uploadFile()` takes up to 10 MB and accepts
JPEG, PNG, WebP, GIF, PDF, DOC, DOCX, and plain text:

```ts
const result = (
  await client.intakeSubmissions().uploadFile<{ path: string; name: string; mime_type: string }>({
    sessionId,
    file: await FileUpload.fromPath('/var/uploads/id-front.jpg'),
  })
).data();

// result === { path: '…/id-front-<uuid>.jpg', name: '…', mime_type: 'image/jpeg' }
```

**Large files — the multipart flow.** Video answers (`video/mp4`,
`video/quicktime`, `video/webm`, up to 200 MB) go through a chunked multipart
upload. `uploadLargeFile()` runs the whole flow for you, streaming the file
from disk one part at a time so memory use stays at the configured part size
regardless of file size, and aborting the upload if any step fails:

```ts
const stored = await client.intakeSubmissions().uploadLargeFile({
  sessionId,
  filePath: '/var/uploads/consult-video.mp4',
});
```

Drive the four calls yourself when you need parts uploaded in parallel, or an
upload resumed in another process:

1. `initiateMultipartUpload()` → returns `upload_id`.
2. `uploadMultipartPart()` once per chunk, in any order → returns
   `{ part_number, etag }`. Collect every pair; the server does not track
   them.
3. `finishMultipartUpload()` with the full set → returns
   `{ path, name, mime_type }`.
4. `abortMultipartUpload()` instead, to cancel — safe to call after a finish or
   a previous abort.

Part sizes must be between `IntakeSubmissions.MIN_PART_SIZE` (5 MB — the
minimum the server accepts for any non-final part) and
`IntakeSubmissions.MAX_PART_SIZE` (25 MB — its cap); the final part may be
smaller. `uploadLargeFile()` defaults to `IntakeSubmissions.DEFAULT_PART_SIZE`
(10 MB). Pass each ETag back exactly as received, surrounding quote characters
included.

Uploaded bytes are **PHI**. The SDK never writes them to a debug log, even with
`debug: true`.

---

## 9. Framework recipes

In every recipe the client is constructed **once**, at module scope, with
credentials read from the environment — never per request — and the visitor's
user agent and IP are forwarded into `sessions().create()` so the resulting
session is attributed to the visitor rather than to your server.

### Express

```ts
// lib/astermd.ts
import { AsterMDClient } from '@astermd-hq/sdk';

export const astermd = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
});
```

```ts
// routes/session.ts
import { Router } from 'express';
import { astermd } from '../lib/astermd.js';

export const router = Router();

router.post('/session', async (req, res, next) => {
  try {
    const { session } = (
      await astermd.sessions().create<{ session: string }>({
        userAgent: req.get('user-agent'),
        clientIp: req.ip,
      })
    ).data();

    res.json({ session });
  } catch (error) {
    next(error);
  }
});
```

### Fastify

```ts
// plugins/astermd.ts
import { AsterMDClient } from '@astermd-hq/sdk';

export const astermd = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
});
```

```ts
// routes/session.ts
import type { FastifyInstance } from 'fastify';
import { astermd } from '../plugins/astermd.js';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/session', async (request, reply) => {
    const { session } = (
      await astermd.sessions().create<{ session: string }>({
        userAgent: request.headers['user-agent'],
        clientIp: request.ip,
      })
    ).data();

    return reply.send({ session });
  });
}
```

### Next.js route handlers

```ts
// lib/astermd.ts
import { AsterMDClient } from '@astermd-hq/sdk';

export const astermd = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
});
```

```ts
// app/api/session/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { astermd } from '../../../lib/astermd';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { session } = (
    await astermd.sessions().create<{ session: string }>({
      userAgent: request.headers.get('user-agent') ?? undefined,
      clientIp: request.headers.get('x-forwarded-for') ?? undefined,
    })
  ).data();

  return NextResponse.json({ session });
}
```

Every recipe relies on the same thing: a module-scope singleton survives for
the life of the process, so the token cache built into `AsterMDClient` is
actually hit after the first request. Constructing `AsterMDClient` inside a
request handler defeats that — do it once, export it, import it everywhere.

---

## 10. Custom transport (BYO HttpClient)

Pass anything implementing `HttpClient` — one method, `sendRequest(request:
Request): Promise<Response>` — into the constructor:

```ts
import { AsterMDClient, type HttpClient } from '@astermd-hq/sdk';

class ProxiedHttpClient implements HttpClient {
  async sendRequest(request: Request): Promise<Response> {
    return await fetch(request, { dispatcher: myProxyAgent });
  }
}

const client = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
  httpClient: new ProxiedHttpClient(),
});
```

The default `FetchHttpClient` exists so the SDK has zero network dependencies;
you only need to swap it in to route traffic through a proxy agent, pin TLS
settings, add your own retry policy, or stub the network out in tests. An
implementation should let a network-level failure surface as `TransportError`
— anything else it throws reaches the caller unwrapped.

---

## 11. Debugging — copy-paste-able curl logs

When you need to reproduce a failing request in Postman or `curl`, pass
`debug: true` at construction. Every outbound request — including the
token-acquisition call — is logged in a copy-pasteable format.

**Credentials are redacted by default.** Bearer tokens, the `client_secret` in
the token-exchange body, `x-phi-verification-token` headers, and
`access_token` / `refresh_token` values in responses are replaced with
`[REDACTED]`. Request and response bodies on `/patients/*` endpoints, and the
raw bytes of file-upload requests, are dropped entirely, because they carry
PII and PHI.

> **What is still logged.** Redaction is not anonymisation. Entries retain full
> URLs, non-sensitive headers, and the bodies of every non-patient endpoint —
> which includes contact details on `opportunities/*`. Treat the log
> destination as sensitive, and apply the same access controls and retention
> rules you would to any other store of customer data. Never commit log files
> to version control.

### Parameters

| Parameter            | Type        | Default | Purpose                                                                          |
| -------------------- | ----------- | ------- | -------------------------------------------------------------------------------- |
| `debug`              | `boolean`   | `false` | Master toggle. All other debug options are ignored when `false`.                 |
| `debugFile`          | `string`    | —       | Base path for the log file. The SDK writes one dated file per day from it.       |
| `debugSink`          | `DebugSink` | —       | `(entry: string) => void \| Promise<void>`. Takes precedence over `debugFile`.   |
| `debugTimezone`      | `string`    | `UTC`   | IANA time zone for timestamps and for the file date.                             |
| `debugRedact`        | `boolean`   | `true`  | Mask credentials and PHI. Set `false` to log verbatim — never in production.     |
| `debugRetentionDays` | `number`    | `7`     | Days of daily log files to keep. `0` keeps everything. Ignored with `debugSink`. |

Either `debugFile` or `debugSink` must be provided when `debug: true`; omitting
both throws `TypeError` at construction.

### Example — file-based logging with daily rotation

```ts
const client = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
  debug: true,
  debugFile: '/var/log/astermd/sdk.log',
  debugRetentionDays: 7, // 0 keeps every file
  // debugTimezone: 'America/New_York', // optional; UTC is the default
});
```

`debugFile` is a **base path**, not the file that gets written. The SDK derives
a dated filename from it, keeping your directory, stem, and extension:

```
/var/log/astermd/sdk-2026-09-08.log   ← today
/var/log/astermd/sdk-2026-09-07.log
/var/log/astermd/sdk-2026-09-01.log   ← removed once older than the retention window
```

Pruning runs once per sink instance, on the first entry written, so it costs
nothing on the hot path. Only files matching the SDK's own
`{stem}-YYYY-MM-DD{ext}` pattern are ever deleted, and the date comes from the
filename rather than the modification time — so a file that was merely touched
still ages out on schedule, and nothing else in the directory is at risk.

### Example — sending logs somewhere other than a file

Supply a `debugSink` function and the SDK writes no files at all. Rotation,
retention, and delivery become your application's concern. This is the
extension point for **any** destination — a logger, a hosted log service, a
cloud provider's logging API, a message queue — and it requires no change
inside the SDK. An asynchronous sink is awaited; any error it throws is
swallowed, because losing a debug entry is never worth failing the request
that produced it.

```ts
const client = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
  debug: true,
  debugSink: entry => logger.debug(entry),
});
```

### Timezone option

Timestamps and log-file dates default to UTC. Pass any IANA timezone string:

```ts
const client = new AsterMDClient({
  clientId: process.env.ASTERMD_CLIENT_ID!,
  clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
  debug: true,
  debugFile: '/var/log/astermd/sdk.log',
  debugTimezone: 'Asia/Kolkata', // timestamps show IST; files roll at IST midnight
});
```

### Log format

Each entry is a blank-line-terminated block:

```
[2026-09-08 14:23:51.123000 UTC]
curl --location --request POST 'https://api.astermd.com/v1/sales/sessions/create' \
  --header 'accept: application/json' \
  --header 'authorization: Bearer [REDACTED]' \
  --header 'content-type: application/json' \
  --data '{}'

# Response: HTTP 200
{"success":true,"message":"ok","data":{"session":"abc"},"meta":{}}

```

Paste the `curl …` block into a terminal or Postman. You will need to
substitute a real token for `[REDACTED]` before it will run; obtain one the
same way the SDK does, or re-run with `debugRedact: false` against
non-production credentials.

If the SDK never received a response, the block ends with `# Transport error:
<message>` in place of the response section.

**Note that redaction covers headers and bodies but never the URL.** Endpoints
that take their input as a query parameter — `verification()`'s address and
email checks, `geo()`'s `info()` and `blocklist()` — log that input verbatim.
Keep that in mind when deciding where debug logs are written and how long
they are kept.

---

## 12. Assets

Product images and other media come back from the API as relative paths.
Resolve them against the AsterMD CDN with `client.assetUrl(path)`:

```ts
const imageUrl = client.assetUrl(product.image);
// => 'https://cdn.astermd.com/{org}/{channel}/products/{file}.png'
```

Treat the result as a **fetch** URL, not a **serve** URL: download the asset
once, store it on your own filesystem or CDN, and serve your own copy to end
users. Hot-linking the AsterMD CDN from a storefront is not supported and is
subject to rate limiting.

---

## Appendix — Common gotchas

- **Don't pass full URLs as `baseHost`.** Just the host (`api.astermd.com`).
  The SDK builds the rest, and the constructor throws `TypeError` if it sees a
  scheme or a path.
- **`opportunities().status()` body is `{ opportunity_status: … }`**, not
  `{ status: … }`. The `patients().status()` body IS `{ status: … }`. They
  differ because the APIs differ.
- **For multi-step teleforms, send the FULL accumulated `data` on every
  update.** The server treats each update as a full snapshot, not a delta.
- **`Medications` has no `view()`** — list only.
- **The token store is in-memory by default**, which is usually right for a
  Node server — one long-running process, one credential exchange. Reach for
  `FileTokenStore` or a custom store only when your deployment runs several
  processes or instances that don't share memory; see §6.
- **`AuthenticationError` after one auto-retry is final.** The SDK does not
  loop; treat it as a configuration error.
- **`sessions().view()` takes an options object**: `view({ sessions: ['uuid']
})` for a single lookup, `view({ sessions: ['a', 'b'] })` to batch-fetch; add
  `tz` to format response timestamps (`view({ sessions: ['uuid'], tz:
'Asia/Kolkata' })`). The real route is `/sessions/view?session_ids=…`
  (comma-joined).
- **Forward the visitor's `User-Agent` and IP yourself.** The SDK runs
  server-to-server, so it cannot see the visitor's browser or IP. For
  device/geo attribution, pass them to `sessions().create({ userAgent,
clientIp })` — the SDK sends them as the `User-Agent` and
  `X-Original-Client-Ip` headers. (`treatments().sync()` likewise accepts
  `userAgent`.) Otherwise the server attributes the call to your Node
  process's own UA/IP. Each header is omitted when its argument is undefined
  or empty.
- **`FileUpload.fromPath()` is asynchronous** (it reads the file); `
FileUpload.fromContents()` is synchronous. It is easy to forget the `await`
  on the former.
- **No `{}`-vs-`[]` JSON footgun.** Unlike the PHP SDK, JavaScript's array and
  object types round-trip through `JSON.stringify` correctly on their own, so
  an empty answer list and an empty attribution object are both sent exactly
  as you wrote them — no special-casing needed on your side.

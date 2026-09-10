# Contributing - @astermd-hq/sdk

Short guide for adding a new endpoint, fixing a bug, or otherwise working on
this package.

## Local setup

```bash
npm install
npm run ci
```

`npm run ci` is the same gate CI runs. A `Makefile` wraps the same scripts
(`make install`, `make ci`, `make test`) if you prefer.

## The gate

`npm run ci` runs, in order:

```
lint → format:check → typecheck → test → build → publint
```

- **lint** - ESLint (`typescript-eslint`), zero warnings tolerated.
- **format:check** - Prettier, checking Markdown as well as source.
- **typecheck** - `tsc --noEmit` under `strict`, `exactOptionalPropertyTypes`,
  and `noUncheckedIndexedAccess`.
- **test** - the full Vitest suite. No test in this package makes a real HTTP
  call.
- **build** - `tsup` produces the dual ESM/CJS output plus declarations.
- **publint** - validates the published package shape (`exports`, `types`,
  `files`) before it ever reaches npm.

Any failure blocks a release. Run `npm run ci` before you consider a change
finished; if you tee multiple commits, run it again on the last one before
opening a PR.

## Branching and commits

- Work on a feature branch off the default branch, or whatever the maintainer
  designates.
- One logical change per commit. Use Conventional Commits prefixes: `feat:`,
  `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- Every commit should keep `npm run ci` green.

## Adding a new endpoint

Most contributions will be "wrap one more endpoint." The pattern is
mechanical:

### 1. Confirm the contract exists

Confirm the endpoint and its request/response schema in the API reference in
your AsterMD dashboard. If the contract is not published there, stop and ask -
never infer a request shape from a sibling endpoint or from a response you
happened to observe. A guessed shape that works today is a breaking change
waiting to happen.

### 2. Add the method to the resource class, with full TSDoc

```ts
/**
 * One-line purpose. TSDoc here carries the same weight as the PHPDoc on the
 * PHP SDK's method: what it does, when to call it, what the caller should do
 * with the result.
 *
 * @param id The resource's id.
 * @param data The fields to change.
 * @returns What `data()` on the response carries.
 * @throws {ValidationError} If a field is rejected.
 * @throws {NotFoundError} If the resource does not exist.
 * @throws {ApiError} On any other non-2xx status.
 * @throws {TransportError} If the request never completed.
 */
async newMethod<T = Record<string, unknown>>(
  id: string,
  data: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  return await this.transport.send<T>({
    service: 'sales', // 'auth' | 'sales' | 'platform'
    method: 'POST',
    path: '/{module}/new-method/{id}',
    pathParams: { id },
    body: data,
    // query: { ... },     // when applicable
    // headers: { ... },   // when applicable, e.g. x-phi-verification-token
  });
}
```

Rules:

- Resources only know about `Transport`. Never touch `fetch`, `Request`,
  `Response`, or `JSON.*` from a resource - that all belongs to `Transport`.
- Return `Promise<ApiResponse<T>>` with `T` defaulting to `Record<string,
unknown>`. Do not invent a per-endpoint typed DTO.
- If client-side validation is genuinely needed (enforcing "either X or Y",
  bounding a numeric argument), throw `TypeError` **before** calling the
  transport - see `DoctorsNetworks.sync()` and
  `IntakeSubmissions.uploadMultipartPart()` for worked examples.

### 3. Write the failing test first

Add a spec under `test/resource/{name}.spec.ts`, using the shared
`test/support/harness.ts` (`makeHarness()`) and `test/support/mock-http-client.ts`
helpers. The template:

```ts
import { describe, expect, it } from 'vitest';
import { NewResource } from '../../src/resource/new-resource.js';
import { OK_ENVELOPE, makeHarness } from '../support/harness.js';

describe('NewResource.newMethod', () => {
  it('sends the expected request', async () => {
    const { transport, http } = makeHarness();
    http.enqueueJson(200, OK_ENVELOPE);

    await new NewResource(transport).newMethod('id-1', { k: 'v' });

    const request = http.lastRequest();
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.astermd.com/v1/sales/new-resource/new-method/id-1');
    expect(JSON.parse(request.body)).toEqual({ k: 'v' });
  });
});
```

Run `npx vitest run test/resource/{name}.spec.ts` and verify the test fails
for the right reason (method does not exist yet) before implementing it.

### 4. Add the accessor to `AsterMDClient` (only if adding a NEW resource)

```ts
#newResource?: NewResource;

newResource(): NewResource {
  return (this.#newResource ??= new NewResource(this.#transport));
}
```

Resource classes extend `AbstractResource` and are not marked `final` in any
sense TypeScript enforces (consumers may extend them). Infrastructure classes
(`Transport`, `TokenManager`, `FetchHttpClient`, `UrlBuilder`) are not designed
for extension - do not build on top of them from outside the package.

### 5. Export anything new from `src/index.ts`

Any new option interface (`NewResourceOptions`, say) needs its own named
export from `src/index.ts` alongside the class. The barrel is the documented
public surface - `test/index.spec.ts` pins its exact export list, so a new
class or interface that should be public needs both the export and an update
to that test's `expected` array.

### 6. Run the full gate

```bash
npm run ci
```

Must end green - lint, format, typecheck, test, build, and publint all pass.
Do not commit until it does.

### 7. Update docs that name the endpoint

- `docs/INTEGRATION_GUIDE.md` §5 - add a row to the resource table.
- `docs/INTEGRATION_GUIDE.md` §4 - add to the order-flow walkthrough only if
  the new method belongs in that flow.
- `README.md` only if the change affects the resource list or quick start.
- `CHANGELOG.md` - add an entry under `## [Unreleased]`.

### 8. Commit

```bash
git add src/resource/new-resource.ts test/resource/new-resource.spec.ts \
        src/astermd-client.ts src/index.ts docs/INTEGRATION_GUIDE.md CHANGELOG.md
git commit -m "feat: add NewResource.newMethod()"
```

## Adding a new error type

Only do this if a status code or condition needs distinct handling that
existing types can't express.

1. Create `src/errors/new-error.ts` extending `ApiError` (or `AsterMDError`
   directly for a non-HTTP failure), following the `*Error` suffix convention.
2. Add a case to the `switch` in `Transport#handle()`
   (`src/http/transport.ts`).
3. Export it from `src/errors/index.ts` and `src/index.ts`, and add it to
   `test/index.spec.ts`'s `expected` array.
4. Add an assertion to `test/http/transport.spec.ts`.
5. Update `docs/INTEGRATION_GUIDE.md` §7's hierarchy diagram and table.

## Conventions

- **Files are kebab-case** (`file-token-store.ts`), the Node convention.
  Exported class names match the PHP SDK exactly (`FileTokenStore`), so a
  reader who knows one SDK can find the equivalent in the other.
- **Error classes end in `Error`** (`ValidationError`, not `ValidationException`
  - this is JavaScript, not PHP), and every one extends `AsterMDError`.
- **Argument style is a hybrid, not one rule for every method:**
  - One required scalar, no optionals → positional:
    `patients().view('p1')`, `verification().verifyEmail('a@b.com')`.
  - Id + payload → positional pair: `opportunities().update('o1', { ... })`.
  - Three or more parameters, or any optional parameter → one options object
    whose keys are the PHP SDK's parameter names: `sessions().create({
userAgent, clientIp })`, `intakeSubmissions().create({ session, event,
teleformId, data, progress })`.
- **Enums are `as const` objects with a matching type alias**, not TypeScript
  `enum` - see `src/enum/event.ts`. A bare string literal satisfies the type,
  which keeps the wire values exactly the PHP SDK's snake_case strings.
- **Value objects are frozen.** `Config`, `Token`, and `Response` call
  `Object.freeze(this)` in their constructors and expose only accessor
  methods - no public mutable fields.
- **The `Response` import gotcha.** The platform's global `Response` type (from
  `fetch`) and the SDK's own `Response` class share a name. Every file that
  needs both imports the SDK's as an alias:
  `import type { Response as ApiResponse } from '../response.js';` and refers
  to the platform type bare. Follow this pattern rather than fighting it with
  a differently named class.
- **`Transport` is the only place that touches HTTP, JSON, or `Request` /
  `Response` types.** If you find yourself calling `fetch`, `JSON.parse`, or
  constructing a `Request` inside a resource, stop - that belongs in
  `Transport`.

## Testing rules

- **Every public method has a test.** A resource method with no spec is not
  considered done.
- **Tests use `MockHttpClient` (via `test/support/harness.ts`'s
  `makeHarness()` or `makeClient()`) and never make a real HTTP call.** There
  is no network in this suite, by design - CI has no external dependency to
  flake on.
- **Each test asserts the shape of the request the resource built**: HTTP
  method, URL (including path substitution and query string), headers that
  matter (`Authorization`, `Content-Type`, any custom header the method sets),
  and the body - parsed and compared as an object, not as a raw string, so key
  order never breaks a test.
- Where a method validates client-side before sending, assert **both**
  branches: the `TypeError` it throws, and that a valid payload still reaches
  the transport unmodified apart from the documented normalisation (e.g.
  `doctors-networks().sync()` stripping `emit_opportunity`).

## Static-analysis and type-safety tips

`tsconfig.json` runs `strict` plus `exactOptionalPropertyTypes` and
`noUncheckedIndexedAccess`. Common friction points:

- An optional property typed `foo?: string` cannot be assigned `undefined`
  explicitly under `exactOptionalPropertyTypes` - either omit the key or widen
  the type to `string | undefined` deliberately.
- Indexing into an array or a `Record` returns `T | undefined` under
  `noUncheckedIndexedAccess`. Narrow before use rather than asserting with `!`
  unless you can justify the assertion in a comment.
- Prefer `Record<string, unknown>` at resource boundaries over `unknown` or
  `any`, and let consumers narrow with a type argument on the method.

## When in doubt

Look at how `Sessions`, `Patients`, or `DoctorsNetworks` are structured - they
cover the three common shapes (simple CRUD, mixed methods including a PHI
header, and client-side validation).

## What not to add

- **No runtime dependencies without maintainer approval.** The zero-dependency
  guarantee is a stated feature of this package; adding one is a breaking
  promise, not a routine change.
- **No wrappers for administrative surfaces.** Analytics, reporting, org/role
  management, and integration management stay out of the SDK by design - see
  `docs/ARCHITECTURE.md`'s "Why the SDK is so small". They belong in the
  AsterMD dashboard.
- **No invented request or response shapes for endpoints whose contract you do
  not have.** If the API reference in your AsterMD dashboard does not describe
  it, do not guess.

## Releasing

Tags follow SemVer (`vMAJOR.MINOR.PATCH`), and `package.json`'s `version`
field must match the tag being released.

1. Ensure the release branch is at the commit you want to ship and `npm run
ci` is green.
2. Move the `## [Unreleased]` entries in `CHANGELOG.md` under the new version,
   with today's date.
3. Bump `version` in `package.json` to match.
4. Tag and push: `git tag vX.Y.Z && git push --tags`.

Pushing the tag triggers the release workflow, which re-runs `npm run ci`,
verifies the tag matches `package.json`'s `version`, and publishes to npm
automatically. There is no manual publish step.

Bugfixes get a PATCH bump. New endpoints get a MINOR bump. Breaking API
changes get a MAJOR bump - and please raise them on a PR first.

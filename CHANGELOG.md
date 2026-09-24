# Changelog

## 1.3.0

Consumer confidence and developer-experience release. This release adds a
contract health check, a real tarball consumer smoke test, CI quality gates and
clearer release/roadmap criteria.

### Added

- **`nuxt-api-contract check <entry>`** with actionable diagnostics for
  duplicate contract names/versions, duplicate routes and path-parameter/schema
  mismatches. Use `--strict` in CI to fail on warnings as well as errors.
- **`npm run test:consumer`**, which builds and packs the package, installs the
  tarball into a temporary clean Nuxt consumer, runs the installed CLI,
  `nuxt prepare` and a production build.
- **CI workflow** for Node 20/22 with lint, typecheck, unit/integration/type
  tests, build, strict contract checking and consumer smoke coverage.

### Changed

- Updated the roadmap to prioritise consumer confidence, CI governance and a
  faster first-run experience before adding more runtime features.
- The package version is now `1.3.0`; the public runtime API remains compatible
  with `1.2.x`.

### Verified

`npm run lint`, `npm run typecheck`, `npm run test:unit` (166 tests),
`npm run test:consumer` and `npm run build` pass on Node 24 with Nuxt 4.5.2.

## 1.2.0

Dependency and Nuxt 4 release: the toolchain moved to the latest majors (Nuxt
4.5, Vite 8, Vitest 5, ESLint 10) and two build-time defects that surfaced when
the module runs from source were fixed. No public API changes.

### Added

- **Nuxt 4 support**, verified end-to-end against Nuxt `4.5.2` (the module keeps
  declaring `nuxt: '>=3.15.0'`; the runtime uses no Nuxt-4-only APIs). The
  playground now follows the Nuxt 4 layout — `playground/app/` for `app.vue` and
  `pages/`, with `server/` and `contracts/` at the root — and shares contracts
  through the `~~` root alias.
- `playground/server/api/users/[id].delete.ts` consumes the module's Nitro
  auto-import preset (`defineContractHandler`, `createApiError`) instead of
  importing them, so the e2e suite fails loudly if auto-import injection ever
  regresses again.

### Docs

- The installation section now states the prerequisites explicitly
  (`Nuxt >= 3.15`, Node requirements) and explains why `nuxt` / `vue` are **not**
  part of `npm install nuxt-api-contract zod` — the module is added to an
  existing app, and installing `nuxt` again would add a second copy of the
  framework. A from-scratch example uses the current official command
  (`npm create nuxt@latest my-app`).

### Fixed

- **Auto-imports now use resolved entry paths** (`src/module.ts`):
  `addImports()` and the Nitro preset registered the bare specifiers
  `nuxt-api-contract/client|composables|server`. Those only resolve when the
  package is installed in `node_modules`; when the module is loaded from source
  (`modules: ['../src/module']`, module development, the playground) or before
  `dist` is built, Nuxt cannot resolve them and **silently disables every
  auto-import** (`NUXT_B6005`). Entries are resolved relative to
  `import.meta.url`, which works from `dist/module.mjs` **and** `src/module.ts`.
- **OpenAPI document and DevTools panel are injected with
  `addServerTemplate()`** instead of being written to
  `buildDir/api-contracts/*.mjs` and exposed through a hand-written
  `#api-contracts-*` alias. This is the supported Nuxt 4 mechanism, keeps the
  generated modules out of `buildDir`, and regenerates their contents on every
  (re)build instead of freezing the document produced during module setup.
- **Contract auto-import directories** are registered through `addImportsDir()`
  rather than by pushing a hand-built relative path into
  `nuxt.options.imports.dirs`.

### Changed

- Dependencies refreshed to the latest releases: `nuxt@4.5`, `@nuxt/kit` /
  `@nuxt/schema@4.5`, `@nuxt/test-utils@4.3`, `@nuxt/eslint-config@1.17`,
  `eslint@10`, `vitest@5`, `defu@6.1.7`, `jiti@2.7`; `vite@8` is a new dev
  dependency (Vitest 5 declares Vite as a required peer).
- Deliberate pins, documented in
  [README → Dependencies & pinned majors](README.md#dependencies--pinned-majors):
  - `h3` stays at `^1.15.11` — the npm `latest` (`2.0.1-rc.x`) is a release
    candidate that Nitro 2 (Nuxt 4.5's server engine) does not use; a second
    copy would introduce incompatible `H3Event` definitions;
  - `typescript` stays at `^5.9.3` — `unbuild`'s `rollup-plugin-dts` declares a
    `typescript ^4.5 || ^5.0` peer and TypeScript 7 is the native compiler port
    without the JS compiler API.
- `engines.node` raised from `>=18.20.0` to `>=20.19.0` (Vite 8 requires
  `^20.19.0 || >=22.12.0`; Nuxt 4 itself requires `^22.19.0 || ^24.11.0 || >=26`).

### Verified

`npm run lint`, `npm run typecheck`, `npm run test:unit` (163 tests),
`npm run test:type` (26), `npm run test:integration` (25) and `npm run build`
pass on Node 24 with Nuxt 4.5.2, with no `NUXT_B6005` warnings left.

## 1.1.0

Audit release: bug fixes and hardening across the client transport, handler
pipeline, mock tooling and DevTools panel. The public API is unchanged
(only additive changes; SemVer patch-level fixes in a minor release per the
roadmap cadence).

### Fixed

- **`tryRequest` no longer loses `issues` / `details`:** `toContractError` now
  returns an already-typed `ApiError` untouched instead of re-wrapping it into
  a bare one (validation issues survived `request` but were dropped by
  `tryRequest`).
- **Deprecation headers on every response path:** `Deprecation` / `Sunset` /
  `Warning` are attached before the pipeline runs, so mocked responses and
  `ApiError` responses of a deprecated contract carry them too (previously
  only successful non-mocked responses did).
- **`ContractMock.delay` is now honored** by `defineContractHandler` (the
  documented "simulated latency" was previously ignored in-process).
- **Unexpected handler failures are logged** with contract method/path before
  answering `500 INTERNAL_ERROR`; expected `ApiError`s stay silent.
- **`versionedPath` type matches runtime for slash-less paths:**
  `versionedPath(3, 'users/:id')` is typed `/api/v3/users/:id` (was
  `/api/v3users/:id`).
- **Strict API version parsing:** `x-api-version: 2abc` / `?v=1.5` are
  rejected instead of being `parseInt`-truncated to a version.
- **Mock generation range bugs:** `z.number().min(1000)` without `max` no
  longer generates out-of-range values (default max was hardcoded to 100);
  `min`-padding of format-constrained strings (`email()`, `uuid()`, …) no
  longer corrupts them (the email local part is padded instead).
- **Standalone mock server aggregates repeated query params into arrays**
  (`?tag=a&tag=b` → `['a', 'b']`), matching h3/ufo semantics; single
  occurrences remain plain strings.
- **DevTools panel works without `openapi.enabled`:** the contract entry is
  loaded whenever the panel is active, and `buildDevtoolsHtml` now renders a
  real self-contained HTML page (table + "Try request" form) instead of raw
  JSON served as `text/html`.
- **`callContract` rejects a handler bound to a different contract** with a
  clear error instead of silently invoking the h3 wrapper as a plain
  contract handler.
- **Generated standalone client:** `query` / `headers` parameters are
  required when their schemas have required fields (were always optional);
  `buildQueryString` serializes `Date` (ISO), `bigint` and objects the same
  way the real transport does.

## 1.0.0

Stable release. The public API is frozen and documented in
[`docs/public-api.md`](docs/public-api.md); SemVer from here on is strict
(patch = fixes, minor = additions, major = breaking changes).

### Added

- **Zod 4 support** (Zod 3 is still supported; peer range
  `zod: ^3.23.0 || ^4.0.0`). Zod 4 changed its internals substantially, so all
  schema reading was moved behind one new abstraction layer,
  `src/runtime/shared/zod-schema.ts` (`describeZodSchema`, `unwrapZodSchema`,
  `zodSchemaKind`):
  - `typeName` (Zod 3) and `type` (Zod 4) are normalized, including the Zod 4
    `$ZodCheck` model (`min_length`/`greater_than`/`string_format`/…), Zod 4
    format schemas (`z.email()`, `z.url()`, `z.iso.datetime()`), `def.shape` as
    a plain object, `def.catchall` strict/loose objects and `pipe` in/out
    nodes;
  - mock generation, OpenAPI generation and TypeScript client emission now
    consume the normalized descriptors instead of `_def`, so both majors
    behave identically;
  - contract input types use Zod's own `input`/`output` helpers. Because Zod 4
    types the input of `z.coerce.*`/`z.preprocess()` as `unknown`, a
    conservative repair restores Zod 3 semantics for coerced fields, keeping
    `z.coerce.number()` query parameters type-safe (see the README
    "Zod version support" section for the exact rules);
  - validation issues carry the machine-readable Zod `code` and no longer
    double-prefix the subject (`query.query.limit` → `query.limit`); Zod 4
    messages are reported verbatim when there is no structured expectation.
- **Multipart / file-upload bodies**: `multipartSchema({ file: z.file(), … })`
  declares a `multipart/form-data` body.
  - client: the body is serialized to `FormData` (files appended as-is, arrays
    repeated, nested objects JSON-encoded, `Date`/`bigint` stringified) and
    passed to `$fetch` untouched (ofetch never JSON-encodes `FormData`, so the
    runtime sets the multipart boundary);
  - server: `defineContractHandler` reads the form parts via
    `readMultipartFormData`, builds a real `File` (falling back to a
    `{ filename, type, size, data }` descriptor with a warning on runtimes
    without `File`) and coerces text fields against the schema —
    numbers/booleans/bigints/dates, arrays, JSON-encoded nested objects and
    unions — before validation;
  - new `bodyFormat: 'auto' | 'json' | 'multipart'` contract option
    (`'auto'` is the default and detects the schema marker); the resolved value
    is exposed as `contract.bodyFormat`;
  - OpenAPI documents multipart bodies with `multipart/form-data` content and
    `z.file()` as `{ type: 'string', format: 'binary' }`;
  - new package exports: `multipartSchema`, `isMultipartSchema`,
    `resolveBodyFormat`, `serializeMultipartBody`, `MULTIPART_SCHEMA`,
    `type BodyFormat` (client) and `readMultipartBody`, `coerceMultipartValue`,
    `type MultipartFileDescriptor` (server).
- Playground: `POST /api/users/:id/avatar` (multipart) contract, handler, page
  form and end-to-end integration tests (upload, missing file, bad coercion,
  handler errors, OpenAPI content type).
- New unit suites: `zod-schema.spec.ts` (runs every expectation against Zod 4
  **and** Zod 3 through `zod/v3`), `multipart.spec.ts`,
  `serialization.spec.ts`; new type tests for multipart bodies.
- Documentation: `docs/public-api.md` (frozen 1.0.0 surface + SemVer policy).

### Changed

- `useApiClient()` is now **synchronous** (it returns the client instead of a
  promise), matching the documented usage `const api = useApiClient(); await
  api.request(…)`. The Nuxt app instance and the SSR request event are captured
  synchronously, so the same client works inside actions, stores and plugins
  without a Nuxt context.
- `useApi()` creates its client during setup instead of inside the async
  handler — same SSR-internal Nitro transport, no hydration mismatch, and no
  reliance on the Nuxt context surviving `await`.
- Mock generation now emits RFC 4122 v4 UUIDs (version **and** variant
  nibbles), which Zod 4 validates strictly; mocks are still deterministic.
- OpenAPI: `null` schemas are emitted as `nullable: true` + `enum: [null]`
  (valid OpenAPI 3.0.3), exclusive bounds use the 3.0 `exclusiveMinimum/
  Maximum: true` form, arrays/sets emit `minItems`/`maxItems`/`uniqueItems`,
  `z.bigint()` is documented as `{ type: 'string', format: 'int64' }`,
  discriminated unions carry `discriminator.propertyName`, and strict objects
  emit `additionalProperties: false`.
- Node engines: `>=18.20.0` (unchanged; file uploads prefer a runtime with a
  global `File`, i.e. Node ≥ 20).
- `nuxt-api-contract/clientgen` no longer exports the Zod-3-only helpers
  `zodDef`/`objectShape`; use the descriptors from `zod-schema.ts` internally
  or the public `emitTsType`/`emitNamedType`/`generateClientSource` helpers.

### Fixed

- All mock generation, OpenAPI generation and client emission worked only with
  Zod 3 internals; with Zod 4 installed they silently degraded to warnings and
  empty schemas.
- Contract type inference returned Zod internals (`$ZodObjectInternals<…>`)
  instead of the schema output with Zod 4.
- Validation messages could repeat the subject prefix (`query.query.limit`).

## 0.6.0

### Added

- **Contract versioning (0.6.0)**:
  - `versionedPath(version, path)` — type-safe `/api/vN` path prefixing; the
    return type is a template literal, so `PathParams` inference keeps working
    (`versionedPath(2, '/users/:id')` -> `/api/v2/users/:id`);
  - versioned registry: same-name contracts with different `version`s are
    stored side by side; `listContractVersions(name)` (sorted ascending),
    `getContractVersion(name, version?)` (latest when omitted) and
    `negotiateContractVersion(name, requested)` (exact match, else closest
    lower, else oldest);
  - `deprecated` contract field (`true` or `{ since, sunset, message }`):
    handlers attach the standard `Deprecation` (@<since> | true), `Sunset`
    (HTTP date) and `Warning: 299` headers; OpenAPI generation marks the
    operation with `deprecated: true` plus `x-deprecated-since` /
    `x-deprecated-sunset` and appends the migration hint to the description;
  - `defineVersionedHandlers(entries, options)` — serve multiple contract
    versions over a single Nitro route: the version is selected via the
    `x-api-version` header or `?v=` query (`resolveRequestedApiVersion`),
    with backward-compatible fallback to the closest lower version
    (disable with `fallback: false`), a configurable `defaultVersion`
    (highest by default) and `404 VERSION_NOT_FOUND` for unknown versions in
    strict mode; per-entry `deprecated` metadata attaches the same headers;
  - auto-imports: `versionedPath`, `getContractVersion`,
    `negotiateContractVersion`, `listContractVersions` (app) and
    `defineVersionedHandlers`, `resolveRequestedApiVersion` (server).

## 0.5.0

### Added

- **External API contracts (pluggable transports)**: contracts may point at
  APIs outside the Nuxt app — either with an absolute URL in `path`
  (`https://api.github.com/users/:username`) or via a new `baseUrl` option.
  Path parameters are extracted from URLs at the type level exactly like for
  internal routes.
- **Pluggable transport**: `useApiClient({ transport })` accepts a custom
  fetch-like function used for external contracts (signing, retries, proxies).
- External requests always go over HTTP (`$fetch` resolves absolute URLs in
  both SSR and browser) — the internal Nitro transport is bypassed.
- HTTP status codes from custom transports are preserved on the typed
  `ApiError` (`error.statusCode`).
- Tooling guards: external contracts are skipped from OpenAPI generation and
  from the mock server with a warning instead of producing wrong declarations.
- 11 unit tests (URL resolution, transport e2e against a local HTTP server,
  tooling guards) and 3 type tests (external params/response/`@ts-expect-error`).

## 0.4.0

### Added

- **Generated external client**: `npx nuxt-api-contract client <entry>
  --output client.ts` produces a standalone, dependency-free TypeScript
  client (global fetch) with typed `Params` / `Query` / `Body` / `Response`
  per contract, path building, query serialization, dynamic headers and
  `ContractClientError` (code / statusCode / issues parsed from the unified
  error format). New package export: `nuxt-api-contract/clientgen`
  (`generateClientSource`, `emitTsType`, `emitNamedType`).
- Emission of TS types from Zod schemas follows the same best-effort + warning
  policy as the OpenAPI layer (transform / preprocess degrade to the underlying
  type, Date/bigint serialize as strings).
- New unit suite (17 tests: type emission, generation, syntax validation via
  the TypeScript parser) and an e2e integration suite running the generated
  client against the mock server.

## 0.3.0

### Added

- **`testContract()` suites**: framework-agnostic contract test helper with
  `expectSuccess`, `expectError`, `expectValidationError`,
  `expectResponseValidationError` and `validateResponse` — uses `callContract`
  under the hood so the full pipeline (validation → handler → response
  validation) is exercised without an HTTP server.
- **Contract coverage**: `startContractCoverage()` / `stopContractCoverage()` /
  `getContractCoverage()` / `formatContractCoverage()` — tracks which registered
  contracts have been exercised and prints a human-readable report.
- New unit suite for `testContract` and coverage.

## 0.2.0

### Added

- **Standalone mock server**: `npx nuxt-api-contract mock <entry>` — serves
  contract endpoints with deterministic generated responses
  (`--port`, `--host`, `--seed`, `--delay`, `--lenient`), CORS enabled,
  `GET /__mock/contracts` lists available endpoints. New package export:
  `nuxt-api-contract/mock` (`createMockServer` / `startMockServer`).
- **Mock generation from contracts**: `generateMockResponse(contract)` builds
  schema-valid data from the response schema (seeded, deterministic; name
  heuristics for email/uuid/url/dates; password/token fields are always
  masked). `autoMockContract(contract)` registers it as a mock preset.
- **`apiContract.mocks: 'auto'`**: contract handlers fall back to generated
  mock responses when no explicit `mockContract()` is registered.
- New integration/unit suites for the generator and the mock server.

## 0.1.0

Initial MVP release.

### Added

- `defineApiContract()` — type-safe contract definitions with path-parameter
  extraction at the type level.
- `defineContractHandler()` — Nitro handler with automatic validation of
  params / query / body / headers and optional response validation
  (`never` / `development` / `always`).
- `useApi()` — reactive typed client (SSR-internal Nitro transport,
  hydration-safe) and `useApiClient()` — imperative client with
  `request()` / `tryRequest()`.
- `createApiError()` / `ApiError` — unified machine-readable error format
  (`{ error: { code, message } }`) with production-safe validation issues.
- Contract registry, `mockContract()` + `apiContract.mocks` mode.
- `callContract()` test helper (validation -> handler -> response validation).
- OpenAPI 3.0 generation: build-time via module option and
  `nuxt-api-contract openapi <entry>` CLI (JSON / minimal YAML).
- Optional DevTools panel with "Try request".
- Contract auto-imports from `contracts/` and `server/contracts/` dirs.
- Vitest unit / type / integration suites and a full playground.

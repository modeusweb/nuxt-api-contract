# Changelog

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

# nuxt-api-contract

Type-safe API contracts between Nitro server routes and the Nuxt client.

Define a contract **once** — get runtime validation, fully typed client calls,
a unified error format, OpenAPI generation, mocks, contract tests and a
DevTools panel from the same source of truth.

> Status: **1.10.0** — stable public API, strict SemVer. The supported surface is
> documented in [docs/public-api.md](docs/public-api.md), with current roadmap
> and migration guidance in [ROADMAP.md](ROADMAP.md) and
> [docs/compatibility.md](docs/compatibility.md).
>
> Requirements: **Nuxt >= 3.15** (verified end-to-end against Nuxt 4.5) and
> **Node >= 20.19** for the package itself — Nuxt 4 requires
> `^22.19.0 || ^24.11.0 || >=26.0.0` on its own. Zod 3 or 4
> (`^3.23.0 || ^4.0.0`).

## Why

Without contracts, the request/response agreement between server and client
lives in three disconnected places: a Zod schema (or nothing), a TS interface
(or nothing) and documentation (or nothing). `nuxt-api-contract` collapses all
of them into one object:

```text
                 ┌── runtime validation (server AND response)
                 │
Contract ─────────┼── TypeScript types (params / query / body / response)
                 │
                 ├── OpenAPI document
                 │
                 ├── DevTools panel
                 │
                 └── mocks + contract tests
```

## Installation

Prerequisites: an existing Nuxt app on **Nuxt >= 3.15** (verified end-to-end
against Nuxt 4.5). `nuxt` and `vue` are deliberately *not* part of the command
below — this module is added to an app that already has them, and installing
`nuxt` again would pull a second copy of the framework. Starting from scratch?
Create the app first (official Nuxt 4 command):

```bash
npm create nuxt@latest my-app
cd my-app
npm install nuxt-api-contract zod
```

The module declares `nuxt: '>=3.15.0'` as its compatibility range, so an
incompatible Nuxt version is reported at build time by Nuxt itself.

Add the module:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-api-contract'],
  apiContract: {
    validateResponse: 'development',
    openapi: { enabled: true, entry: 'contracts/index.ts' },
    devtools: true,
    mocks: false,
  },
})
```

Zod is a peer dependency: `zod: ^3.23.0 || ^4.0.0` (both majors are supported,
see [Zod version support](#zod-version-support)).

## Quick start

### Scaffold a new Nuxt app

```bash
npx nuxt-api-contract init my-api
cd my-api
npm install nuxt vue zod nuxt-api-contract
npx nuxt-api-contract check contracts/index.ts
npx nuxt prepare
```

The command creates a minimal Nuxt 4-compatible project with a health contract,
Nitro handler and OpenAPI configuration. It refuses to overwrite an existing
`package.json` unless `--force` is supplied.

### Check a contracts entry

Validate names, routes and path parameters before generating documentation or
starting the application:

```bash
npx nuxt-api-contract check contracts/index.ts
```

Use `--strict` in CI to fail on warnings as well as errors.

### OpenAPI drift check

Generate and then validate a committed or local OpenAPI artifact:

```bash
nuxt-api-contract openapi contracts/index.ts --output openapi.json
nuxt-api-contract openapi contracts/index.ts --output openapi.json --check
```

The `--check` form fails when the file is missing or stale.


```ts
// contracts/users.ts
import { z } from 'zod'
import { defineApiContract } from 'nuxt-api-contract/client'

export const GetUser = defineApiContract({
  name: 'GetUser',
  method: 'GET',
  path: '/api/users/:id',
  params: z.object({ id: z.string() }),
  response: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
  }),
})
```

```ts
// server/api/users/[id].get.ts
import { GetUser } from '../../../contracts/users'
import { createApiError, defineContractHandler } from 'nuxt-api-contract/server'

export default defineContractHandler(GetUser, async ({ params }) => {
  const user = await db.find(params.id) // params is typed & validated
  if (!user) throw createApiError('USER_NOT_FOUND', 'User not found', 404)
  return user
})
```

```vue
<!-- pages/users/[id].vue -->
<script setup lang="ts">
const route = useRoute()
const { data, error, pending } = await useApi(GetUser, {
  params: { id: route.params.id as string },
})
// data.value?.name -> string | undefined (fully typed)
</script>
```

Passing `params: { id: 123 }` is a **TypeScript error**; an invalid request is
rejected at runtime with a `VALIDATION_ERROR`.

## Defining contracts

```ts
defineApiContract({
  name: 'CreateUser',          // optional; registers in the registry
  version: 1,                  // optional metadata
  method: 'POST',              // GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS
  path: '/api/users',          // `:param` segments become required params
  params: z.object({}),        // path params schema
  query: z.object({}),         // query schema (use z.coerce for numbers)
  body: z.object({}),          // body schema (JSON)
  bodyFormat: 'auto',          // 'auto' | 'json' | 'multipart' (1.0.0)
  headers: z.object({}),       // raw header schema
  response: z.object({}),      // success response schema
  errors: { EMAIL_TAKEN: z.object({}) }, // known error payloads by code
  summary / description / tags, // OpenAPI metadata
  auth: true,                  // informational / extension point
  metadata: {},                // free-form, consumed by tooling
})
```

Types are always **inferred** — you never write generics by hand. Path
parameters are extracted from the path itself: a contract for
`/api/posts/:postId/comments/:commentId` requires
`params: { postId: string, commentId: string }` even without a params schema.

### Query values

The browser sends query values as strings. Use `z.coerce.number()` (and
friends) for numeric query parameters; validation always happens on the server.

## Server handlers

`defineContractHandler(contract, handler)` performs, in order:

1. validation of `headers`, `params`, `query`, `body` against the schemas;
2. invocation of your handler with **validated, typed** data + the raw `H3Event`;
3. optional response validation (see configuration);
4. conversion of thrown `ApiError`s into the unified error payload.

Handler context:

```ts
interface ContractHandlerContext {
  params   // validated path params
  query    // validated query
  body     // validated body (undefined for GET/HEAD without body schema)
  headers  // validated headers (raw record when no schema)
  event    // H3Event
  user?    // reserved for auth integrations
}
```

## Client usage

```ts
// Reactive (SSR-aware, no hydration mismatch):
const { data, error, pending, refresh } = await useApi(GetUser, { params: { id } })

// Imperative (actions, Pinia, event handlers):
const api = useApiClient()
const user = await api.request(GetUser, { params: { id } })            // throws ApiError
const { data, error } = await api.tryRequest(GetUser, { params: { id } })
```

`useApiClient()` is synchronous and captures the Nuxt app + SSR request event
when it is called, so it also works inside Pinia actions, plugins and other
non-setup code as long as it runs in a Nuxt context (or in a Nitro route during
SSR).

Both work in the browser, during SSR and after hydration. During SSR the
request is executed **inside Nitro** (`event.$fetch`) — no HTTP round-trip to
itself; the payload is transferred to the client automatically.

## Multipart / file uploads (1.0.0)

Declare the body with `multipartSchema()`; the transport, the server parsing and
the OpenAPI document follow automatically.

```ts
// contracts/users.ts
import { z } from 'zod'
import { defineApiContract, multipartSchema } from 'nuxt-api-contract/client'

export const UploadAvatar = defineApiContract({
  name: 'UploadAvatar',
  method: 'POST',
  path: '/api/users/:id/avatar',

  params: z.object({ id: z.string() }),

  body: multipartSchema({
    file: z.file(),                             // Zod 4. On Zod 3 use z.instanceof(File)
    caption: z.string().max(120).optional(),
    crop: z.coerce.boolean().optional(),
    width: z.coerce.number().int().positive().optional(),
  }),

  response: z.object({
    fileName: z.string(),
    size: z.number().int(),
    contentType: z.string(),
  }),
})
```

```ts
// server/api/users/[id]/avatar.post.ts
export default defineContractHandler(UploadAvatar, async ({ body }) => {
  // `body.file` is a real File instance; text fields are already coerced.
  return {
    fileName: body.file.name,
    size: body.file.size,
    contentType: body.file.type,
  }
})
```

```vue
<script setup lang="ts">
const api = useApiClient()

async function upload(file: File) {
  const { data, error } = await api.tryRequest(UploadAvatar, {
    params: { id: '1' },
    body: { file, caption: 'profile photo', crop: true, width: 512 },
  })
}
</script>
```

How values are transported:

| Client value | On the wire | Server value |
| --- | --- | --- |
| `File` / `Blob` | file part (filename + content type preserved) | `File` |
| `string` | text part | `string` |
| `number`, `boolean`, `bigint`, `Date` | stringified | coerced back according to the schema |
| array | repeated parts with the same name | array |
| nested object | JSON string | parsed + coerced |
| `null` / `undefined` | field omitted | `undefined` (defaults/optional apply) |

Notes and limitations:

- `bodyFormat: 'json' | 'multipart'` can be set explicitly; the default
  `'auto'` detects the `multipartSchema()` marker. The resolved value is exposed
  as `contract.bodyFormat`.
- Coercion covers numbers, booleans, bigints, dates, arrays, JSON-encoded
  objects and unions. Anything else stays a string so Zod reports an accurate
  validation error.
- File fields require a runtime with a global `File` (Node ≥ 20, Workers,
  Nitro). On runtimes without `File` the package passes
  `{ filename, type, size, data }` (`MultipartFileDescriptor`) and logs a
  warning once.
- The standalone generated client (`clientgen`) still generates JSON bodies
  only; file uploads there are on the [roadmap](ROADMAP.md).

## Zod version support

`zod: ^3.23.0 || ^4.0.0` are both supported from the same contract source.
Zod 4 changed its internals (`_def.type` instead of `_def.typeName`, the
`$ZodCheck` model, `pipe` in/out, `def.catchall`), so all schema reading goes
through one internal abstraction layer used by validation helpers, mock
generation, OpenAPI generation and TypeScript emission.

Two intentional differences, both in favour of type safety:

1. **Coerced inputs keep Zod 3 semantics.** Zod 4 types the input of
   `z.coerce.*` as `unknown`, which would accept anything from the client. The
   package repairs such fields to the schema output type, so
   `z.coerce.number()` query params behave exactly as they did on Zod 3:

   ```ts
   useApi(SearchUsers, { query: { limit: 20 } })      // ok
   useApi(SearchUsers, { query: { limit: '20' } })    // TypeScript error
   ```

   The repair applies to top-level object fields (including union members);
   arrays, tuples and non-plain objects (`Date`, `File`, `Map`, …) are left
   untouched, and nested objects are not rewritten recursively.

2. **Response/request validation is unchanged.** The server still validates
   with `safeParse`, so coercion happens exactly once and always on the server.

Validation issues carry the machine-readable Zod `code` (Zod 4 also reports
length/format problems with descriptive messages, which are printed verbatim).

## Error handling

```ts
throw createApiError('USER_NOT_FOUND', 'User not found', 404)
// or
throw createApiError({ code: 'VALIDATION_ERROR', statusCode: 400, details })
```

Wire format:

```json
{ "error": { "code": "USER_NOT_FOUND", "message": "User not found" } }
```

On the client, `error` (from `useApi`) or the caught value (from
`useApiClient().request`) is a reconstructed `ApiError` with `code`,
`statusCode`, `details` and `issues`. Check it with `isApiError(value)`.

Validation errors are readable:

```text
[nuxt-api-contract]

Invalid query for GET /api/users

query.limit:
  Expected number
  Received string
```

In production, `received` values are stripped (they may contain passwords or
tokens) and internal error messages are never leaked.

## SSR

Handled automatically by the transport layer:

```text
Browser          → HTTP $fetch
SSR              → internal Nitro call (event.$fetch)
After hydration  → payload from useAsyncData, no refetch, no mismatch
```

## OpenAPI

Configure the module (build-time generation from a contracts entry file):

```ts
apiContract: {
  openapi: {
    enabled: true,
    entry: 'contracts/index.ts',   // default array or named exports
    path: '/_api-contracts/openapi.json',
    title: 'My API',
  },
}
```

Or from the CLI (works without a Nuxt build):

```bash
npx nuxt-api-contract openapi contracts/index.ts --output openapi.json
npx nuxt-api-contract openapi contracts/index.ts --output openapi.yaml
```

Zod → OpenAPI conversion is a separate abstraction layer
(`nuxt-api-contract/openapi`). Unsupported Zod features (transform, refine,
preprocess) degrade to the closest representable schema with a warning —
generation never fails.

### Generated external client

Generate a standalone, dependency-free TypeScript client from contracts for
consumers outside your Nuxt app (another frontend, a script, a backend service):

```bash
npx nuxt-api-contract client contracts/index.ts --output client.ts
# --client-name createApiClient to rename the factory function
```

The generated file uses only global `fetch`, has zero imports, typed
`Params`/`Query`/`Body`/`Response` per contract, path building, query
serialization, dynamic headers and a `ContractClientError` with
`code` / `statusCode` parsed from the unified error format:

```ts
import { createClient, ContractClientError } from './client'

const api = createClient({ baseUrl: 'https://api.example.com', headers: () => ({ authorization: token() }) })

const user = await api.getUser({ params: { id: '1' } }) // typed as GetUserResponse
try {
  await api.createUser({ body: { name: 'John', email: 'john@example.com' } })
} catch (error) {
  if (error instanceof ContractClientError) console.error(error.code, error.statusCode)
}
```

Programmatic API: `import { generateClientSource } from 'nuxt-api-contract/clientgen'`.
Like the OpenAPI layer, non-representable Zod features (`transform`, etc.)
degrade to the closest type with a warning instead of failing.

## External API contracts

Contracts can describe APIs outside your Nuxt app (0.5.0). Two equivalent ways:

```ts
// absolute URL in `path`
export const GitHubUser = defineApiContract({
  name: 'GitHubUser',
  method: 'GET',
  path: 'https://api.github.com/users/:username',
  params: z.object({ username: z.string() }),
  response: z.object({ login: z.string(), id: z.number() }),
})

// or split base from path
export const StripeCharge = defineApiContract({
  name: 'StripeCharge',
  method: 'POST',
  path: '/v1/charges/:id',
  baseUrl: 'https://api.stripe.com',
  response: z.object({ status: z.string() }),
})
```

`useApi` / `useApiClient` handle both transparently:

- path parameters are extracted from URLs at the type level (`:username` is
  required, unknown parameters are type errors);
- external requests always go over HTTP (`$fetch` resolves absolute URLs natively
  on the server and in the browser) — the internal Nitro transport is never used;
- a custom transport can be plugged in:

```ts
const api = useApiClient({
  transport: async (url, init) => {
    // sign, retry, route through a proxy — anything
    const response = await fetch(url, init as RequestInit)
    if (!response.ok) { /* throw; it becomes a typed ApiError */ }
    return response.json()
  },
})
const user = await api.request(GitHubUser, { params: { username: 'nuxt' } })
```

Guards: external contracts are skipped from OpenAPI generation and from the
mock server (with a warning) — they are not local operations and cannot be
mocked server-side. Errors from external APIs are still surfaced as typed
`ApiError` when the remote speaks the `{ error: { code, message } }` format.

## Mocking

```ts
import { mockContract, autoMockContract } from 'nuxt-api-contract/client'

mockContract(GetUser, { response: () => ({ id: '1', name: 'Mocked User' }) })
autoMockContract(GetUser, { seed: 42 }) // generated from the response schema
```

Enable `apiContract: { mocks: true | 'auto' }` and contract handlers return
mock responses (still validated against the response schema). With `'auto'`,
contracts without an explicit `mockContract()` fall back to generated data.

### Standalone mock server

Serve contract endpoints without a Nuxt build (frontend development against a
not-yet-implemented backend):

```bash
npx nuxt-api-contract mock contracts/index.ts --port 4000 --seed 42
# add --lenient to skip request validation, --delay 300 for artificial latency
```

Or programmatically:

```ts
import { startMockServer } from 'nuxt-api-contract/mock'

const mock = await startMockServer({ contracts: [GetUser, ListUsers], port: 4000 })
// GET /__mock/contracts lists available endpoints; CORS is enabled.
await mock.close()
```

Responses are deterministic for a given `--seed`; password/token fields are
always masked.

## Testing

Full pipeline without an HTTP server:

```ts
import { callContract } from 'nuxt-api-contract/testing'

const { data, error } = await callContract(GetUser, handler, { params: { id: '1' } })
expect(error).toBeNull()
expect(data.id).toBe('1')
```

`callContract` runs validation → handler → response-validation exactly like
production. See `test/integration/playground.test.ts` for full-stack tests with
`@nuxt/test-utils`.

### Contract test suites

`testContract()` wraps a contract + handler into an assertion suite. It is
framework-agnostic (works with Vitest, Jest, `node:assert` — any runner that
treats thrown errors as failures):

```ts
import { testContract } from 'nuxt-api-contract/testing'

const suite = testContract(GetUser, handler)

it('returns the user', async () => {
  const data = await suite.expectSuccess({ params: { id: '1' } })
  expect(data.name).toBe('John')
})

it('returns 404 for missing user', async () => {
  const error = await suite.expectError(
    { params: { id: 'missing' } },
    'USER_NOT_FOUND',
    404,
  )
})
```

Available assertions:

| method | meaning |
| --- | --- |
| `expectSuccess(input?)` | call succeeds; returns typed response data |
| `expectError(input?, code?, statusCode?)` | call fails with (optionally) the given code/status |
| `expectValidationError(input?, issuePaths?)` | fails with `VALIDATION_ERROR`; optionally checks issue paths |
| `expectResponseValidationError(input, badResponse)` | handler returns bad data caught by response validation |
| `validateResponse(value)` | validates an arbitrary value against the contract's response schema |

### Contract coverage

Record which registered contracts are exercised in tests and print a report:

```ts
import {
  startContractCoverage,
  stopContractCoverage,
  formatContractCoverage,
} from 'nuxt-api-contract/testing'

beforeAll(() => startContractCoverage())
afterAll(() => console.log(formatContractCoverage(stopContractCoverage())))
```

Output:

```
Contract coverage
  5/6 contracts covered (83%)
Covered:
  ✓ GET    /api/users/:id                    3 ok
  ✓ POST   /api/users                        2 ok (1 failed)
Uncovered:
  ✗ DELETE /api/users/:id  (DeleteUser)
```

Coverage is driven by the same `callContract` pipeline, so it works for both
unit tests and integration tests.

### Contract coverage

Export `getContractCoverage()` from your test setup and enforce a threshold in
local or project-owned CI:

```bash
node dist/cli.mjs coverage .audit/coverage.json --min 80
```

The command exits non-zero when the report is below the requested percentage.

### DevTools

The `check` command now reports deprecated contracts as warnings and tells
consumers to migrate before the sunset date. The standalone mock server accepts
`only: ['ContractName']` to restrict the served routes and `scenario`/`fixtures`
for named response states. DevTools supports
`metadata: { redact: ['password', 'token'] }` for the fields displayed in its
request response panel. CLI equivalents are
`nuxt-api-contract mock <entry> --only NameA,NameB` and
`nuxt-api-contract mock <entry> --scenario empty --fixtures fixtures.json`.

contracts (method, path, params, tags, error codes) and includes a
"Try request" form. The panel shows HTTP status, request duration and whether
the response body is valid JSON. DevTools is optional — the module works
normally without it. `@nuxt/devtools-kit` is imported dynamically and guarded.

## Configuration

```ts
apiContract: {
  validateResponse: 'development', // 'never' | 'development' | 'always'
  mocks: false,
  devtools: true,
  contractsDirs: ['contracts', 'server/contracts'], // contract auto-import dirs
  openapi: {
    enabled: false,
    path: '/_api-contracts/openapi.json',
    entry: 'contracts/index.ts',
    title: undefined, version: undefined, description: undefined,
  },
}
```

Runtime config (private, never in `public`):

```json
{ "apiContract": { "validateResponse": "development", "mocks": false } }
```

## Architecture

```text
src/
├── module.ts            # Nuxt module (build-time)
├── cli.ts               # `nuxt-api-contract openapi | mock | client` CLI
├── openapi/             # Zod -> OpenAPI (isolated, build-time only)
├── clientgen/           # Zod -> TypeScript client (build-time only)
├── mock/                # standalone mock server (build-time only)
├── client.ts            # client-safe barrel (contracts, errors, mocks, multipart)
├── composables.ts       # useApi / useApiClient (requires Nuxt context)
├── server.ts            # server barrel (handler, validation, multipart)
├── testing.ts           # callContract / testContract helpers
└── runtime/
    ├── shared/          # contract, types, errors, format, serialization,
    │                    # zod-schema (Zod 3/4 introspection), mock, multipart, versioning
    ├── client/          # transport, useApi
    └── server/          # defineContractHandler, validation, multipart, versioning, routes
```

The single source of truth for schema reading is
`runtime/shared/zod-schema.ts`: it normalizes Zod 3 and Zod 4 definitions into
one descriptor used by mocks, OpenAPI and client generation, so no consumer
touches `_def` / `_zod.def` directly.

Server-only code never reaches the client bundle; the OpenAPI generator, CLI,
client generator and DevTools are not part of any runtime import chain
(importing `useApi` adds ~4 kB). See [docs/architecture.md](docs/architecture.md).

## Package exports

| Export | Purpose |
| --- | --- |
| `nuxt-api-contract` | Module definition (for `modules: []`) |
| `nuxt-api-contract/client` | Client-safe: `defineApiContract`, `createApiError`, registry, mocks, `multipartSchema` |
| `nuxt-api-contract/composables` | `useApi`, `useApiClient` (Nuxt context required) |
| `nuxt-api-contract/server` | `defineContractHandler`, validation + multipart helpers |
| `nuxt-api-contract/testing` | `callContract`, `testContract`, coverage |
| `nuxt-api-contract/openapi` | OpenAPI generator |
| `nuxt-api-contract/clientgen` | Standalone typed client generator |
| `nuxt-api-contract/mock` | Standalone mock server + mock generators |
| `nuxt-api-contract/shared` | Shared primitives |

The full, frozen surface is listed in
[docs/public-api.md](docs/public-api.md).

## Contract versioning

Contracts can be versioned with the `version` field and the `versionedPath`
helper (0.6.0).

### Versioned paths

```ts
import { versionedPath } from 'nuxt-api-contract/client'
import { z } from 'zod'

export const GetUserV2 = defineApiContract({
  name: 'GetUser',
  version: 2,
  method: 'GET',
  path: versionedPath(2, '/users/:id'), // -> /api/v2/users/:id
  params: z.object({ id: z.string() }),
  response: z.object({ id: z.string(), name: z.string() }),
})
```

The return type of `versionedPath` is a template literal
(`/api/v2/users/:id`), so path-parameter inference stays fully type-safe.

### Versioned registry

Same-name contracts with different versions are stored side by side:

```ts
import { getContractVersion, listContractVersions, negotiateContractVersion } from 'nuxt-api-contract/client'

listContractVersions('GetUser')       // [v1, v2] sorted ascending
getContractVersion('GetUser', 1)      // exact version, or the latest when omitted
negotiateContractVersion('GetUser', 5) // exact -> closest lower -> oldest
```

### Deprecation

```ts
export const GetUserV1 = defineApiContract({
  name: 'GetUser',
  version: 1,
  method: 'GET',
  path: versionedPath(1, '/users/:id'),
  params: z.object({ id: z.string() }),
  response: z.object({ id: z.string(), name: z.string() }),
  deprecated: { since: 2, sunset: '2027-01-01', message: 'Use /api/v2' },
})
```

Handlers attach the standard response headers:

```text
Deprecation: @2
Sunset: 2027-01-01
Warning: 299 - "Use /api/v2"
```

OpenAPI generation marks such operations with `deprecated: true`,
`x-deprecated-since` and `x-deprecated-sunset`.

### Version negotiation (single route)

Serve multiple versions from one Nitro route; the client picks a version
with the `x-api-version` header or a `?v=` query parameter:

```ts
// server/api/users/[id].get.ts
import { defineVersionedHandlers } from 'nuxt-api-contract/server'

export default defineVersionedHandlers([
  { version: 1, handler: defineContractHandler(GetUserV1, v1Handler), deprecated: { since: 2 } },
  { version: 2, handler: defineContractHandler(GetUserV2, v2Handler) },
], { defaultVersion: 2 })
```

Behavior:

- exact version match wins;
- otherwise the closest lower version is served (backward-compatible
  fallback; disable with `fallback: false`);
- unknown versions respond with `404 VERSION_NOT_FOUND` when fallback is off;
- `defaultVersion` (highest by default) is served when the client requests
  no version;
- per-entry `deprecated` metadata attaches the same deprecation headers.

## Limitations

- File uploads require a runtime with a global `File` (Node ≥ 20). Without it,
  file parts are passed as `{ filename, type, size, data }` descriptors.
- Multipart coercion is one level deep per field: text fields, arrays,
  JSON-encoded objects and unions are covered; deeply nested multipart
  structures are not invented.
- With Zod 4, coerced (`z.coerce.*`) inputs are repaired at the top level of an
  object schema — see [Zod version support](#zod-version-support).
- OpenAPI 3.1 is available with `openapiVersion: '3.1'`; the default remains
  OpenAPI 3.0.3 for backward compatibility.
- Auto-discovery is directory-based (`contracts/`, `server/contracts/`) rather
  than a build-time scanner.
- The standalone generated client supports multipart request bodies via
  `FormData`; it no longer JSON-stringifies multipart payloads.
- OpenAPI generation supports `strict: true` and authenticated contracts emit
  bearer security metadata without implementing authentication.

## Roadmap

See [docs/compatibility.md](docs/compatibility.md) for supported runtimes and
migration policy. Use `npm run test:governance` for local contract/OpenAPI
checks, `npm run test:coverage` for a coverage report threshold, and
`npm run test:consumer` for a clean packed-package check.
validation, typed client, SSR transport, registry, mocks, mock server, contract
testing, OpenAPI generation, generated client, external contracts, versioning,
**Zod 4 support**, **multipart bodies**, the 1.1.0 audit fixes and the
**Nuxt 4 toolchain** (module `addServerTemplate` usage + auto-import resolution
fixes). Post-1.0 candidates are listed in the roadmap.

## Development

```bash
npm run build        # build the package (unbuild)
npm run dev:prepare  # unbuild --stub (stub the entries for the playground)
npm run test         # unit + integration tests
npm run test:consumer # build, pack, install and build a temporary Nuxt consumer
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
```

The playground is a real Nuxt 4 app and uses the Nuxt 4 directory layout:

```text
playground/
├── app/               # app.vue + pages/ (the Nuxt 4 `srcDir`)
├── contracts/         # contracts shared by server and client (module option)
├── server/api/        # defineContractHandler routes
└── nuxt.config.ts     # modules: ['../src/module'] — the module runs from source
```

Run it with `npm run dev:prepare && npx nuxt dev playground`: the module is
loaded from `src/`, which is also the configuration that catches auto-import
resolution bugs (see [Dependencies & pinned majors](#dependencies--pinned-majors)).
The e2e suite (`test/integration/playground.test.ts`) builds and serves the same
playground with `@nuxt/test-utils`.

To run the e2e suite against the **built** package instead of the source (the
npm-consumer code path: `dist/module.mjs`, `dist/runtime/**` Nitro routes,
`dist/*.mjs` auto-import entries), build first and set
`API_CONTRACT_MODULE=dist`:

```bash
npm run build
# PowerShell:  $env:API_CONTRACT_MODULE='dist'; npm run test:integration
# bash:        API_CONTRACT_MODULE=dist npm run test:integration
```

### Dependencies & pinned majors

Every dependency is kept on its latest release, with three deliberate
exceptions that are documented because they are *not* accidental:

| Package | Range | Why not `latest` |
| --- | --- | --- |
| `h3` | `^1.15.11` | npm `latest` is `2.0.1-rc.x`, a release candidate. Nuxt 4.5 / Nitro 2 (`@nuxt/nitro-server`) ship `h3 ^1.15.11`; a second copy would give the runtime two incompatible `H3Event` definitions. |
| `typescript` | `^5.9.3` | `unbuild`'s declaration step (`rollup-plugin-dts`) declares a `typescript ^4.5 \|\| ^5.0` peer; TypeScript 7 is the native (Go) compiler port without the JS compiler API, so builds/type tests cannot use it yet. |
| `vite` | `^8.3.0` | Vitest 5 declares Vite as a *required* peer, so it is an explicit dev dependency. Vite 8 is also what `@nuxt/vite-builder` 4.5 uses. |

`zod` stays a peer dependency (`^3.23.0 || ^4.0.0`) — adding a Zod major is a
minor release, dropping one is a major release.

## Publishing & Versioning

Versioning follows strict SemVer since 1.0.0:

- **1.0.x** (patch) — bug fixes, docs, internal changes;
- **1.x.0** (minor) — new exports, new optional options, new schema kinds;
- **2.0.0** (major) — breaking changes to anything listed in
  [docs/public-api.md](docs/public-api.md).

Supported Zod majors are part of the public API (`^3.23.0 || ^4.0.0`); adding a
major is a minor release, dropping one is a major release.

Release flow:

```bash
# 1. Bump the version (updates package.json, creates a git tag):
npm version patch   # or: minor | major | prerelease --preid=rc

# 2. Push with tags:
git push --follow-tags

# 3. Publish (prepublishOnly runs lint + typecheck + unit/type tests + build):
npm publish

# Pre-release dist-tag (e.g. 0.2.0-rc.1):
npm publish --tag next
```

The package name `nuxt-api-contract` is published unscoped with public access.
`npm pack --dry-run` shows exactly what ships: `dist/**` (bundled entries +
`dist/runtime` for Nitro routes) plus README/LICENSE/CHANGELOG — no sources,
tests or playground.

## License

[MIT](./LICENSE) © modeusweb

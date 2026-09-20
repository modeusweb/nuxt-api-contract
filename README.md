# nuxt-api-contract

Type-safe API contracts between Nitro server routes and the Nuxt client.

Define a contract **once** — get runtime validation, fully typed client calls,
a unified error format, OpenAPI generation, mocks, contract tests and a
DevTools panel from the same source of truth.

> Status: `0.x` (pre-1.0, SemVer). The public API is intentionally small.

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

```bash
npm install nuxt-api-contract zod
```

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

Zod (`^3.23`) is a peer dependency.

## Quick start

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
  body: z.object({}),          // JSON body schema
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
const api = await useApiClient()
const user = await api.request(GetUser, { params: { id } })            // throws ApiError
const { data, error } = await api.tryRequest(GetUser, { params: { id } })
```

Both work in the browser, during SSR and after hydration. During SSR the
request is executed **inside Nitro** (`event.$fetch`) — no HTTP round-trip to
itself; the payload is transferred to the client automatically.

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
const api = await useApiClient({
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

## DevTools

When `apiContract.devtools` is enabled in development, a panel lists all
contracts (method, path, params, tags, error codes) and includes a
"Try request" form. DevTools is optional — the module works normally without
it. `@nuxt/devtools-kit` is imported dynamically and guarded.

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
├── cli.ts               # `nuxt-api-contract openapi` CLI
├── openapi/             # Zod -> OpenAPI (isolated, build-time only)
├── client.ts            # client-safe barrel (contracts, errors, helpers)
├── composables.ts       # useApi / useApiClient (requires Nuxt context)
├── server.ts            # server barrel (handler, validation)
├── testing.ts           # callContract test helper
└── runtime/
    ├── shared/          # contract, types, errors, format, serialization
    ├── client/          # transport, useApi
    └── server/          # defineContractHandler, validation, routes
```

Server-only code never reaches the client bundle; the OpenAPI generator, CLI
and DevTools are not part of any runtime import chain (importing
`useApi` adds ~4 kB). See [docs/architecture.md](docs/architecture.md).

## Package exports

| Export | Purpose |
| --- | --- |
| `nuxt-api-contract` | Module definition (for `modules: []`) |
| `nuxt-api-contract/client` | Client-safe: `defineApiContract`, `createApiError`, registry, mocks |
| `nuxt-api-contract/composables` | `useApi`, `useApiClient` (Nuxt context required) |
| `nuxt-api-contract/server` | `defineContractHandler`, validation helpers |
| `nuxt-api-contract/testing` | `callContract` |
| `nuxt-api-contract/openapi` | OpenAPI generator |
| `nuxt-api-contract/mock` | Standalone mock server + mock generators |
| `nuxt-api-contract/shared` | Shared primitives |

## Limitations

- Zod 3.x only (`^3.23`); Zod 4 support is on the roadmap.
- Request bodies are JSON; `multipart/form-data` (file uploads) is planned —
  the contract abstraction already does not assume JSON-only bodies.
- OpenAPI conversion is best-effort for `transform` / `refine` / `preprocess`.
- Auto-discovery is directory-based (`contracts/`, `server/contracts/`) rather
  than a build-time scanner.

## Roadmap

See [ROADMAP.md](ROADMAP.md). In short: **0.1.0** core contracts + OpenAPI +
DevTools and **0.2.0** standalone mock server / generated mocks are released;
next: 0.3.0 extended contract testing, 0.4.0 OpenAPI client generation,
0.5.0 external API contracts, 0.6.0 contract versioning, 1.0.0 stable API.

## Development

```bash
npm run build        # build the package (unbuild)
npm run test         # unit + integration tests
npm run test:type    # type tests (vitest typecheck)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
```

## Publishing & Versioning

Versioning follows SemVer with the usual 0.x semantics:

- **0.x.y** (current): `y` (patch) — bug fixes; `x` (minor) — features **and**
  documented breaking changes (pre-1.0 policy, always listed in CHANGELOG.md).
- **1.0.0+**: strict SemVer — breaking changes only in major releases.

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

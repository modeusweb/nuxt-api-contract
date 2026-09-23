# Architecture

## Goals (in priority order)

```text
Correctness > Type safety > Developer experience > Nuxt integration
> Performance > Feature count
```

The contract is the **single source of truth**. Nothing else — no separate TS
interfaces, no separate OpenAPI schemas, no generated client — is required for
the core flow.

## Package structure

```text
src/
├── module.ts                 Nuxt module (build-time concerns only)
├── module/devtoolsHtml.ts    DevTools panel data builder
├── cli.ts                    `nuxt-api-contract openapi|mock|client` CLI (jiti loader)
├── openapi/
│   └── generator.ts          Contract/Zod -> OpenAPI (isolated layer)
├── clientgen/
│   ├── generator.ts          Contract -> standalone TypeScript client
│   └── zodToTs.ts            Zod -> TypeScript type emission
├── mock/
│   └── server.ts             Standalone mock server (node:http, no framework)
├── client.ts                 client-safe barrel (loadable OUTSIDE Nuxt)
├── composables.ts            useApi / useApiClient (needs #imports)
├── server.ts                 server barrel
├── testing.ts                callContract barrel
├── shared.ts                 shared primitives barrel
├── types.d.ts                build-time virtual module declarations
├── types/imports.d.ts        repo-local shims for #imports / #app
└── runtime/
    ├── shared/               contract, types, errors, format, serialization,
    │                         zod-schema, mock, multipart, versioning
    ├── client/               transport, useApi
    ├── server/               defineContractHandler, validation, multipart,
    │                         versioning, routes
    └── testing/              callContract
```

### Zod version support (the introspection layer)

Zod 3 and Zod 4 expose different internals for the same public API:

| Concept | Zod 3 | Zod 4 |
| --- | --- | --- |
| schema kind | `_def.typeName` (`ZodString`) | `_def.type` (`string`) |
| checks | `_def.checks[].kind` (`min`, `email`, UUID formats…) | `checks[]._zod.def.check` (`min_length`, `string_format`, `greater_than`, …) |
| format schemas | always checks (`z.string().email()`) | also schema-level (`z.email()`, `z.iso.datetime()`) |
| object shape | `_def.shape()` function | plain object |
| strict / loose objects | `_def.unknownKeys` | `_def.catchall` (`never` / `unknown`) |
| refine / superRefine | `ZodEffects` wrapper | `custom` check on the same schema |
| transform / preprocess | `ZodEffects` (`effect.type`, `schema`) | `pipe` (`in` / `out`) |
| literal / enum values | `_def.value`, `_def.values[]` | `_def.values[]`, `_def.entries` |

`runtime/shared/zod-schema.ts` normalizes all of it into `ZodSchemaDescriptor`
(kind, checks, shape, element, options, in/out, defaults, …) plus
`unwrapZodSchema()` for wrapper metadata (optional / nullable / default /
checks). Consumption rules:

- **mock generation**, **OpenAPI generation** and **TypeScript emission** read
  only descriptors — they never touch `_def` / `_zod.def`;
- `ExtractSchemaInput` / `ExtractSchemaOutput` use Zod's own `input` / `output`
  helpers (Zod 4 declares `ZodType`'s first two parameters as `any`, so
  structural `infer` extraction silently yields the internals);
- a conservative input repair restores Zod 3 semantics for fields whose Zod 4
  input is `unknown` (`z.coerce.*`, `z.preprocess()`), keeping coerced query
  params type-safe without rewriting arrays, tuples or non-plain objects.

The layer is verified against both majors in `test/unit/zod-schema.spec.ts`
(Zod 4 plus the `zod/v3` build shipped by Zod 4).

### Body transports

```text
contract.bodyFormat            (resolved at definition time)
  'auto'  → multipartSchema marker ? 'multipart' : 'json'
  'json'      → JSON payload
  'multipart' → FormData / multipart parts

client: serializeMultipartBody(body) -> FormData -> $fetch (untouched; ofetch
        never JSON-encodes FormData, the runtime sets the boundary)
server: readMultipartBody(event, schema)
          ├─ readMultipartFormData(event)  (h3)
          ├─ text parts -> string, file parts -> File (or descriptor)
          └─ coerceMultipartValue(schema, body)  schema-driven coercion
```

### Import-safety rules

| Layer | May import | Must never import |
| --- | --- | --- |
| `runtime/shared` | zod, ofetch | h3, `#imports`, nitro |
| `runtime/client` | shared, `#imports` | h3 server APIs |
| `runtime/server` | shared, h3 | `#imports` app composables |
| `openapi/`, `cli.ts` | shared, zod, jiti | anything runtime |
| `client.ts` barrel | shared only | `#imports` (critical: contracts are loaded by jiti at build time) |

`nuxt-api-contract/client` must stay importable from plain Node (jiti, unit
tests, CLI). That is why `useApi` lives in a separate `composables` entry.

## Type flow

```text
defineApiContract(def)  --const TDef-->  ContractFromDefinition<TDef>
  = ApiContract<TMethod, TPath, TParams, TQuery, TBody, THeaders, TResponse>

PathParams<TPath>            type-level split of the path string
ExtractSchemaInput/Output    z.input / z.output of optional schemas

useApi options:              ApiRequestOptions<C>
  params required  <=> path params exist (or params schema has keys)
  query required   <=> contract.query is defined
  body required    <=> contract.body is defined
  headers required <=> contract.headers is defined

handler context:             ContractHandler<C> (z.infer of each schema)
handler return:              z.input<response>   (input side)
client data:                 z.output<response>  (output side)
```

Key detail: `ContractFromDefinition` uses `PickDefKey` instead of raw
`TDef['params']` indexing — missing keys in the const-captured literal resolve
to `unknown` when indexed directly, which breaks the `AnyApiContract` bound.

## Runtime flow (request)

```text
useApi(contract, opts)
  └─ createRequestKey(contract, opts)          stable SSR cache key
  └─ useAsyncData(key, () => request())
       └─ useApiClient()
            ├─ import.meta.server && event → event.$fetch(url, init)   [Nitro internal]
            └─ else → nuxtApp.$fetch(url, init)                        [HTTP]
                 └─ buildRequestPath(path, params) + serializeQuery
       └─ on FetchError → toContractError → ApiError{code,statusCode,...}
```

Nitro route (server):

```text
defineContractHandler(contract, handler)
  ├─ validate headers  (raw record; strings only)
  ├─ validate params   (event.context.params)
  ├─ validate query    (getQuery)
  ├─ validate body     (readValidatedBody; skipped for GET/HEAD)
  ├─ mock shortcut     (runtimeConfig.apiContract.mocks + mockContract)
  ├─ handler({ params, query, body, headers, event })
  ├─ response validation  (mode from runtimeConfig: never/development/always)
  └─ catch ApiError → setResponseStatus + return { error: { code, ... } }
```

The error payload is returned **directly** (not wrapped in h3's error
envelope), so the client reads `FetchError.data` as `{ error: {...} }`.

## Build-time flow (module)

1. Merge module options; set private runtimeConfig `apiContract`
   (`validateResponse`, `mocks`) and public `public.apiContract.mocks`.
2. Register app auto-imports (`defineApiContract`, `useApi`, ...).
3. Register Nitro auto-import presets (`defineContractHandler`, ...).
4. Push `contracts/` + `server/contracts/` into app auto-import dirs
   (lightweight auto-discovery).
5. If `openapi.enabled`: jiti-load the entry, generate the document, write
   `.nuxt/api-contracts/openapi.mjs`, alias `#api-contracts-openapi`, add a
   Nitro route serving it.
6. If `devtools` (dev only) **or** `openapi.enabled`: jiti-load the contract
   entry; if `devtools`, render the panel page (contract table + "Try
   request" form) to `.nuxt/api-contracts/devtools.mjs`, alias
   `#api-contracts-devtools`, add a Nitro route serving it as `text/html`;
   try dynamic `@nuxt/devtools-kit` custom-tab registration. OpenAPI document
   generation happens only when `openapi.enabled`.

## Dependency graph (runtime, client bundle)

```text
composables → client/transport → shared        (~4 kB, no openapi/cli/devtools)
server      → shared, h3                       (server bundle only)
openapi/cli → shared, zod, jiti                (build-time only)
```

## Testing strategy

- **Unit** (`test/unit`): path building, contract/registry, errors, formatting,
  serialization, Zod introspection (Zod 4 **and** Zod 3 via `zod/v3`), mock
  generation, OpenAPI generation, validation, multipart serialization/coercion,
  `callContract`, `testContract`, versioning.
- **Type** (`test/type`): `expectTypeOf` positive + negative (`@ts-expect-error`)
  cases for params/query/body/headers/response, defaults, nullable, arrays,
  nested objects, discriminated unions, handler context, multipart bodies.
- **Integration** (`test/integration`): Nuxt Test Utils e2e against the
  playground — validation, typed errors, coercion, POST/PATCH/DELETE, real
  multipart uploads, OpenAPI route/content types, SSR page rendering; plus the
  standalone mock server and the generated client.
- Regression rule: every fixed bug gets a test in the matching layer.

## Stability

Since 1.0.0 the public surface is frozen and documented in
[public-api.md](public-api.md). Internal modules (the introspection layer, the
transport, chunk names) are explicitly **not** part of it and may change in a
patch release.

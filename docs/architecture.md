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
├── cli.ts                    `nuxt-api-contract openapi|mock` CLI (jiti loader)
├── openapi/
│   └── generator.ts          Contract/Zod -> OpenAPI (isolated layer)
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
    ├── shared/               contract, types, errors, format, serialization
    ├── client/               transport, useApi
    ├── server/               defineContractHandler, validation, routes
    └── testing/              callContract
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
6. If `devtools` (dev only): write panel data to
   `.nuxt/api-contracts/devtools.mjs`, alias `#api-contracts-devtools`, add a
   Nitro route; try dynamic `@nuxt/devtools-kit` custom-tab registration.

## Dependency graph (runtime, client bundle)

```text
composables → client/transport → shared        (~4 kB, no openapi/cli/devtools)
server      → shared, h3                       (server bundle only)
openapi/cli → shared, zod, jiti                (build-time only)
```

## Testing strategy

- **Unit** (`test/unit`): path building, contract/registry, errors, formatting,
  serialization, OpenAPI generation, validation, `callContract`.
- **Type** (`test/type`): `expectTypeOf` positive + negative (`@ts-expect-error`)
  cases for params/query/body/headers/response, defaults, nullable, arrays,
  nested objects, discriminated unions, handler context.
- **Integration** (`test/integration`): Nuxt Test Utils e2e against the
  playground — validation, typed errors, coercion, POST/PATCH/DELETE, OpenAPI
  route, SSR page rendering.
- Regression rule: every fixed bug gets a test in the matching layer.

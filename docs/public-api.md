# Public API (frozen in 1.0.0)

This document is the contract this package has with its users. Everything
listed here is supported under strict SemVer:

- **patch** (`1.0.x`) — bug fixes, internal changes, documentation;
- **minor** (`1.x.0`) — new exports, new optional options, new schema kinds;
- **major** (`2.0.0`) — anything listed here can change or be removed.

Anything *not* listed here (internal modules such as
`runtime/shared/zod-schema.ts`, `client/transport.ts`, chunk names, `dist`
layout) may change in a patch release.

## Entry points

| Import | Environment | Purpose |
| --- | --- | --- |
| `nuxt-api-contract` | build time | the Nuxt module (`modules: ['nuxt-api-contract']`) |
| `nuxt-api-contract/client` | universal | contract definition, errors, mocks, multipart, shared types |
| `nuxt-api-contract/composables` | client (Nuxt context) | `useApi`, `useApiClient` |
| `nuxt-api-contract/server` | server only | handlers, validation, multipart reading |
| `nuxt-api-contract/shared` | universal | same surface as `/client` (kept for symmetry) |
| `nuxt-api-contract/testing` | tests | `callContract`, `testContract`, coverage helpers |
| `nuxt-api-contract/openapi` | build time | OpenAPI generation |
| `nuxt-api-contract/clientgen` | build time | standalone TypeScript client generation |
| `nuxt-api-contract/mock` | build time | standalone mock server |
| `nuxt-api-contract/package.json` | build time | package metadata |

## Contracts and handlers

| Export | Entry | Notes |
| --- | --- | --- |
| `defineApiContract(definition)` | `/client`, `/server` | freezes the contract and registers it when `name` is set |
| `isApiContract(value)` | `/client`, `/server` | type guard |
| `buildRequestPath(path, params)` | `/client`, `/server` | resolves `:param` placeholders |
| `registerContract` / `getContractByName` / `listRegisteredContracts` / `clearContractRegistry` | `/client`, `/server` | registry API |
| `mockContract(contract, mock)` / `getContractMock(contract)` | `/client`, `/server` | explicit mocks |
| `autoMockContract(contract, options?)` / `generateMockResponse(contract, options?)` / `generateMockValue(schema, key, ctx)` / `createRng(seed)` | `/client`, `/shared` | deterministic mock generation |
| `multipartSchema(shape)` / `isMultipartSchema(value)` / `resolveBodyFormat(input)` / `serializeMultipartBody(body)` / `MULTIPART_SCHEMA` | `/client`, `/shared` | multipart bodies (1.0.0) |
| `defineContractHandler(contract, handler)` | `/server` | validated handler |
| `defineVersionedHandlers(entries, options?)` / `resolveRequestedApiVersion(event)` | `/server` | version negotiation over one route |
| `versionedPath(version, path)` / `hasVersionedPath` / `listContractVersions` / `getContractVersion` / `negotiateContractVersion` / `normalizeDeprecation` / `getDeprecationHeaders` / `isDeprecatedContract` | `/client`, `/shared` | contract versioning |

## Client

| Export | Entry | Notes |
| --- | --- | --- |
| `useApi(contract, options?)` | `/composables` (auto-imported) | returns `AsyncData<Response, ApiError>` |
| `useApiClient(options?)` | `/composables` (auto-imported) | **synchronous**; returns `{ request, tryRequest }` |
| `type ApiClient` | `/composables` | shape of the returned client |
| `serializeQuery` / `serializeQueryValue` / `stableStringify` | `/client`, `/shared` | documented serialization helpers |

## Errors, validation, serialization

| Export | Entry | Notes |
| --- | --- | --- |
| `createApiError(...)` / `ApiError` / `isApiError` | `/client`, `/server` | unified error format |
| `serializeApiError` / `parseApiErrorPayload` / `toApiError` / `BUILT_IN_ERROR_CODES` | `/client`, `/server` | payload helpers |
| `toValidationIssues` / `formatValidationMessage` / `sanitizeIssues` | `/client`, `/server` | issue formatting |
| `shouldValidateResponse` / `validateContractInput` / `validateContractResponse` / `readRuntimeConfig` / `rawQuerySchema` | `/server` | validation primitives |
| `readMultipartBody(event, schema?)` / `coerceMultipartValue(schema, value)` | `/server` | multipart reading (1.0.0) |

## Types (stable names)

Types are covered by the same policy. The exported type surface includes:
`HttpMethod`, `PathParams`, `SplitPath`, `AuthConfig`, `DeprecationInfo`,
`ApiContractDefinition`, `ApiContract`, `AnyApiContract`,
`ContractFromDefinition`, `ContractPathParams`, `ContractParamsInput`,
`ContractQueryInput`, `ContractBodyInput`, `ContractHeadersInput`,
`ContractHandlerResponse`, `ContractClientResponse`, `ContractErrorCode`,
`ApiRequestOptions`, `ResolvedApiRequestOptions`, `ExtractSchemaInput`,
`ExtractSchemaOutput`, `ApiErrorPayload`, `CreateApiErrorInput`,
`ValidationIssue`, `BodyFormat`, `MultipartFileDescriptor`, `ContractMock`,
`MockResponseInput`, `MockGenerateOptions`, `RngContext`,
`ContractHandlerContext`, `ContractHandler`, `ResponseValidationMode`,
`RuntimeApiContractConfig`, `UseApiClientOptions`, `ApiClient`,
`ContractTestSuite`, `ContractTestInput`, `TestHandler`,
`ContractCoverageReport`, `ContractCoverageEntry`, `GenerationWarning`,
  `CoverageThresholdResult`,

`JsonSchemaObject`, `OpenApiOptions`, `OpenApiGenerationResult`,
`ClientGenerationOptions`, `ClientGenerationResult`, `MockServerOptions`,
`MockServerHandle`, `EmissionMode`, `ModuleOptions`.

## Nuxt module options

```ts
export default defineNuxtConfig({
  modules: ['nuxt-api-contract'],
  apiContract: {
    validateResponse: 'development',     // 'never' | 'development' | 'always'
    mocks: false,                        // false | true | 'auto'
    devtools: true,
    contractsDirs: ['contracts', 'server/contracts'],
    openapi: {
      enabled: false,
      path: '/_api-contracts/openapi.json',
      entry: 'contracts/index.ts',
      title: 'API Contracts',
      version: '0.1.0',
      description: undefined,
      strict: false,
      openapiVersion: '3.0' as const,
    },
  },
})
```

`validateResponse`, `mocks` and `mocksAuto` are propagated through
`runtimeConfig.apiContract`; `runtimeConfig.public.apiContract` only carries the
non-sensitive `mocks` flag. Secrets never belong in either place.

## Auto-imports

Registered at build time:

- **app**: `defineApiContract`, `createApiError`, `isApiError`, `mockContract`,
  `versionedPath`, `getContractVersion`, `negotiateContractVersion`,
  `listContractVersions`, `useApi`, `useApiClient`, `defineContractHandler`,
  `defineVersionedHandlers`, `resolveRequestedApiVersion`;
- **Nitro**: `defineContractHandler`, `createApiError`, `defineApiContract`,
  `defineVersionedHandlers`, `resolveRequestedApiVersion`, `versionedPath`.

Everything else must be imported from the entry points above.

## SemVer policy in practice

- Adding a contract field, schema kind, transport or export is a **minor**
  change.
- Making an optional option required, renaming an export, changing the unified
  error payload or changing how existing schemas are inferred is a **major**
  change.
- Supported Zod versions are part of the public API
  (`zod: ^3.23.0 || ^4.0.0`); dropping or adding a major is documented in the
  changelog and follows SemVer (dropping one is a major release).


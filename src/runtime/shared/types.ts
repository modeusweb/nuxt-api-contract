import type { ZodType } from 'zod'

/**
 * Marker used to identify contract objects at runtime (and in the registry).
 */
export const API_CONTRACT_KIND = 'api-contract' as const

/**
 * Supported HTTP methods.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

/* ------------------------------------------------------------------ *
 * Type-level path parsing
 * ------------------------------------------------------------------ */

/**
 * Splits a string path into its segments at the type level.
 * `/api/users/:id` -> ['api', 'users', ':id']
 */
export type SplitPath<TPath extends string> = TPath extends `${infer Head}/${infer Tail}`
  ? [...SplitPath<Head>, ...SplitPath<Tail>]
  : TPath extends '' ? [] : [TPath]

/**
 * Extracts the path parameter object from a path string.
 * `/api/posts/:postId/comments/:commentId` -> { postId: string, commentId: string }
 */
export type PathParams<TPath extends string> = {
  [Segment in SplitPath<TPath>[number] as Segment extends `:${infer Name}` ? Name : never]: string
}

/* ------------------------------------------------------------------ *
 * Schema type helpers
 * ------------------------------------------------------------------ */


export interface AuthConfig {
  required?: boolean
  roles?: readonly string[]
  [key: string]: unknown
}

/**
 * Deprecation metadata for a contract. When set, contract handlers attach the
 * standard `Deprecation` / `Sunset` response headers and log a dev warning.
 */
export interface DeprecationInfo {
  /** Version since which the contract is deprecated. */
  since?: number
  /** ISO date (e.g. `2026-12-31`) after which the contract may be removed. */
  sunset?: string
  /** Free-form migration hint surfaced to consumers. */
  message?: string
}

/**
 * The input accepted by `defineApiContract()`. All schema fields are optional;
 * generics capture the literal types the user provided.
 */
export interface ApiContractDefinition<
  TMethod extends HttpMethod = HttpMethod,
  TPath extends string = string,
  TParams extends ZodType | undefined = ZodType | undefined,
  TQuery extends ZodType | undefined = ZodType | undefined,
  TBody extends ZodType | undefined = ZodType | undefined,
  THeaders extends ZodType | undefined = ZodType | undefined,
  TResponse extends ZodType | undefined = ZodType | undefined,
> {
  /** Unique contract name, used by the registry / DevTools / OpenAPI. */
  name?: string
  /** Optional contract version (see roadmap: contract versioning). */
  version?: number
  method: TMethod
  path: TPath
  /**
   * External API base URL. When set, `path` is resolved against it and the
   * request bypasses the internal Nitro transport entirely (see 0.5.0:
   * external API contracts). `path` may also be an absolute URL itself.
   */
  baseUrl?: string
  /** Path parameters schema, e.g. `z.object({ id: z.string().uuid() })`. */
  params?: TParams
  /** Query parameters schema. */
  query?: TQuery
  /** Request body schema. */
  body?: TBody
  /** Request headers schema (validated against raw header values). */
  headers?: THeaders
  /** Successful response schema. */
  response?: TResponse
  /** Known error payloads keyed by machine-readable error code. */
  errors?: Record<string, ZodType>
  /** OpenAPI summary. */
  summary?: string
  /** OpenAPI description. */
  description?: string
  /** OpenAPI tags. */
  tags?: readonly string[]
  /** Marks the endpoint as requiring authentication (informational / extension point). */
  auth?: boolean | AuthConfig
  /**
   * Marks the contract as deprecated (0.6.0 contract versioning). Handlers
   * attach `Deprecation` / `Sunset` headers; OpenAPI marks the operation.
   */
  deprecated?: boolean | DeprecationInfo
  /** Free-form metadata consumed by tooling (DevTools, mocks, docs). */
  metadata?: Record<string, unknown>
}

/* ------------------------------------------------------------------ *
 * Contract (what `defineApiContract` returns)
 * ------------------------------------------------------------------ */

/**
 * A frozen, type-safe API contract — the single source of truth for
 * runtime validation, TypeScript types, OpenAPI, DevTools and mocks.
 */
export interface ApiContract<
  TMethod extends HttpMethod = HttpMethod,
  TPath extends string = string,
  TParams extends ZodType | undefined = ZodType | undefined,
  TQuery extends ZodType | undefined = ZodType | undefined,
  TBody extends ZodType | undefined = ZodType | undefined,
  THeaders extends ZodType | undefined = ZodType | undefined,
  TResponse extends ZodType | undefined = ZodType | undefined,
> {
  readonly kind: typeof API_CONTRACT_KIND
  readonly method: TMethod
  readonly path: TPath
  /** Base URL for external API contracts (see `isExternalContract`). */
  readonly baseUrl: string | undefined
  readonly name: string | undefined
  readonly version: number | undefined
  readonly params: TParams
  readonly query: TQuery
  readonly body: TBody
  readonly headers: THeaders
  readonly response: TResponse
  readonly errors: Readonly<Record<string, ZodType>> | undefined
  readonly summary: string | undefined
  readonly description: string | undefined
  readonly tags: readonly string[] | undefined
  readonly auth: boolean | AuthConfig | undefined
  /** Deprecation info (0.6.0 contract versioning), normalized to `DeprecationInfo | true | undefined`. */
  readonly deprecated: boolean | DeprecationInfo | undefined
  readonly metadata: Readonly<Record<string, unknown>> | undefined
}

/**
 * Extracts a definition property, defaulting to `undefined` when the key is
 * absent from the captured (const-inferred) literal type.
 */
type PickDefKey<TDef, TKey extends 'params' | 'query' | 'body' | 'headers' | 'response'> =
  TKey extends keyof TDef ? TDef[TKey] : undefined

/**
 * Maps a definition literal into the resolved contract type.
 */
export type ContractFromDefinition<TDef extends ApiContractDefinition> = ApiContract<
  TDef['method'],
  TDef['path'],
  PickDefKey<TDef, 'params'>,
  PickDefKey<TDef, 'query'>,
  PickDefKey<TDef, 'body'>,
  PickDefKey<TDef, 'headers'>,
  PickDefKey<TDef, 'response'>
>

/**
 * Input type produced by a Zod schema, or an empty object when absent.
 */
export type ExtractSchemaInput<T> = T extends ZodType<any, any, infer Input> ? Input : Record<never, never>

/**
 * Any contract, with all generics widened. Used as a variance-friendly bound.
 */
export type AnyApiContract = ApiContract<
  HttpMethod,
  string,
  ZodType | undefined,
  ZodType | undefined,
  ZodType | undefined,
  ZodType | undefined,
  ZodType | undefined
>

/* ------------------------------------------------------------------ *
 * Derived client / handler types
 * ------------------------------------------------------------------ */

export type ContractPathParams<C extends AnyApiContract> = C extends { path: infer TPath extends string }
  ? PathParams<TPath>
  : Record<never, never>

/**
 * The params the client must send: the intersection of the params schema
 * input and the parameters extracted from the path itself.
 */
export type ContractParamsInput<C extends AnyApiContract> =
  ExtractSchemaInput<C['params']> & ContractPathParams<C>

export type ContractQueryInput<C extends AnyApiContract> = ExtractSchemaInput<C['query']>
export type ContractBodyInput<C extends AnyApiContract> = ExtractSchemaInput<C['body']>
export type ContractHeadersInput<C extends AnyApiContract> = ExtractSchemaInput<C['headers']>

/** Response type as returned by handlers (Zod input side). */
export type ContractHandlerResponse<C extends AnyApiContract> = ExtractSchemaInput<C['response']>

/** Response type as received by the client (Zod output side). */
export type ContractClientResponse<C extends AnyApiContract> = ExtractSchemaOutput<C['response']>

/** Known error codes declared on the contract, plus built-in codes. */
export type ContractErrorCode<C extends AnyApiContract> =
  | (C extends { errors: infer TErrors } ? keyof TErrors & string : never)
  | 'VALIDATION_ERROR'
  | 'API_CONTRACT_RESPONSE_VALIDATION_ERROR'
  | 'INTERNAL_ERROR'

export type MaybePromise<T> = T | Promise<T>

export type EmptyObject = Record<never, never>

export type IsEmptyObject<T> = keyof T extends never ? true : false

/**
 * Request options accepted by `useApi` / `useApiClient`.
 * Requiredness of `params` / `query` / `body` / `headers` is derived from the
 * contract: an option is required when its schema (or the path) demands it,
 * and optional (or rejected) otherwise.
 */
export type ApiRequestOptions<C extends AnyApiContract> =
  (IsEmptyObject<ContractParamsInput<C>> extends true
    ? { params?: ContractParamsInput<C> }
    : { params: ContractParamsInput<C> }) &
  (undefined extends C['query']
    ? { query?: ContractQueryInput<C> }
    : { query: ContractQueryInput<C> }) &
  (undefined extends C['body']
    ? { body?: ContractBodyInput<C> }
    : { body: ContractBodyInput<C> }) &
  (undefined extends C['headers']
    ? { headers?: ContractHeadersInput<C> }
    : { headers: ContractHeadersInput<C> }) & {
    /** Abort signal forwarded to the underlying fetch. */
    signal?: AbortSignal
    /** Extra request headers merged after validated ones (e.g. Authorization). */
    extraHeaders?: Record<string, string>
  }

/** Loose runtime representation of request options (after serialization). */
export type ResolvedApiRequestOptions = {
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}



/**
 * Output type produced by a Zod schema, or `unknown` when absent.
 */
export type ExtractSchemaOutput<T> = T extends ZodType<infer Output, any, any> ? Output : unknown

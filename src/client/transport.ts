import type { AnyApiContract, ApiRequestOptions, ContractClientResponse, ResolvedApiRequestOptions  } from '../runtime/shared/types'
import { resolveContractUrl } from '../runtime/shared/contract'
import { ApiError, parseApiErrorPayload, toApiError } from '../runtime/shared/errors'
import { serializeQuery, stableStringify } from '../runtime/shared/serialization'
import { resolveBodyFormat, serializeMultipartBody } from '../runtime/shared/multipart'


/** Stable cache key for a contract request (identical on server and client). */
export function createRequestKey(contract: AnyApiContract, options: ApiRequestOptions<AnyApiContract> | undefined): string {
  const { params, query, body, extraHeaders, ...rest } = options ?? {}
  return [
    contract.name ?? contract.path,
    contract.method,
    contract.path,
    stableStringify({ params, query, body, extraHeaders, rest }),
  ].join('|')
}

/** Serializes typed request options into the loose runtime shape. */
export function resolveRequestOptions(options: ApiRequestOptions<AnyApiContract> | undefined): ResolvedApiRequestOptions {
  if (!options) return {}
  return {
    params: options.params as Record<string, unknown> | undefined,
    query: serializeQuery(options.query as Record<string, unknown> | undefined),
    body: options.body,
    headers: { ...(options.headers as Record<string, string> | undefined), ...options.extraHeaders },
    signal: options.signal,
  }
}

/**
 * Converts an unknown fetch failure into a typed `ApiError`.
 * Understands the `{ error: { code, message, ... } }` payload produced by
 * contract handlers and wraps everything else into `INTERNAL_ERROR`.
 */
export function toContractError(error: unknown): ApiError {
  const errWithData = error as { data?: unknown; statusCode?: unknown }
  if (errWithData && typeof errWithData === 'object' && 'data' in errWithData) {
    const payload = parseApiErrorPayload(errWithData.data)
    if (payload) {
      return new ApiError({
        code: payload.code,
        message: payload.message,
        statusCode: payload.statusCode ?? (typeof errWithData.statusCode === 'number' ? errWithData.statusCode : 500),
        details: payload.details,
        issues: payload.issues,
      })
    }
  }
  const wrapped = toApiError(error)
  return new ApiError({
    code: wrapped.code,
    message: error instanceof Error ? error.message : wrapped.message,
    statusCode: error instanceof Error && 'statusCode' in error && typeof (error as { statusCode?: unknown }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500,
  })
}

export type ContractFetch = (url: string, init: Record<string, unknown>) => Promise<unknown>

/**
 * Environment-provided fetch factory. Receives the contract so transports can
 * distinguish internal Nitro routes from external API calls.
 */
export type ResolveFetch = (contract: AnyApiContract) => ContractFetch

export interface ExecuteRequestContext {
  /**
   * Performs the actual fetch. Implemented per environment:
   * - SSR: internal Nitro `event.$fetch` (no HTTP round-trip).
   * - Browser: Nuxt `$fetch`.
   * Receives the contract so external API contracts (absolute URL / `baseUrl`)
   * can bypass the internal transport and go straight over HTTP.
   */
  fetch: ContractFetch | ResolveFetch
}

function unwrapFetch(doFetch: ExecuteRequestContext['fetch'], contract: AnyApiContract): ContractFetch {
  return typeof doFetch === 'function' && doFetch.length >= 2
    ? doFetch as ContractFetch
    : (doFetch as ResolveFetch)(contract)
}

/**
 * Executes a contract request and returns the parsed (already validated by
 * the server) response. Throws a typed `ApiError` on failure.
 */
export async function executeContractRequest<C extends AnyApiContract>(
  contract: C,
  options: ApiRequestOptions<C> | undefined,
  doFetch: ExecuteRequestContext['fetch'],
): Promise<ContractClientResponse<C>> {
  const resolved = resolveRequestOptions(options as ApiRequestOptions<AnyApiContract> | undefined)
  const url = resolveContractUrl(contract, resolved.params)
  const fetchImpl = unwrapFetch(doFetch, contract)
  const hasBodySchema = contract.body !== undefined
  const hasBody = resolved.body !== undefined || hasBodySchema
  const multipart = resolveBodyFormat(contract) === 'multipart'
  // `FormData` is passed through by `$fetch`/ofetch untouched (it detects it and
  // never JSON-encodes it), so the runtime adds the multipart boundary itself.
  const body = multipart ? serializeMultipartBody(resolved.body ?? {}) : resolved.body
  try {
    const response = await fetchImpl(url, {
      method: contract.method,
      query: resolved.query,
      body: contract.method === 'GET' || contract.method === 'HEAD' ? undefined : hasBody ? body ?? {} : undefined,
      headers: resolved.headers,
      signal: resolved.signal,
    })
    return response as ContractClientResponse<C>
  } catch (error) {
    throw toContractError(error)
  }
}

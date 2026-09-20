/**
 * Contract testing utilities.
 *
 * `callContract` executes the full pipeline — request validation, handler,
 * response validation — without an HTTP server, which makes it usable in
 * plain Vitest unit tests.
 */
import type { EventHandler, H3Event } from 'h3'
import type {
  AnyApiContract,
  ContractClientResponse,
  ContractHandlerResponse,
} from '../runtime/shared/types'
import { ApiError } from '../runtime/shared/errors'
import { validateContractInput, validateContractResponse } from '../server/validation'
import type { ContractHandler } from '../server/defineContractHandler'
import { recordCoverageCall } from './coverage'

/** Marker set by `defineContractHandler` on the returned event handler. */
const CONTRACT_HANDLER_META = Symbol.for('nuxt-api-contract.contractHandlerMeta')

export interface ContractHandlerMeta {
  contract: AnyApiContract
  handler: (ctx: {
    params: unknown
    query: unknown
    body: unknown
    headers: unknown
    event: H3Event
  }) => Awaitable<unknown>
}

type Awaitable<T> = T | Promise<T>

type AnyFunction = (...args: unknown[]) => unknown

interface InternalContractHandler extends AnyFunction {
  [CONTRACT_HANDLER_META]?: ContractHandlerMeta
}

/**
 * Calls a contract handler pipeline directly (no HTTP server):
 *
 * ```ts
 * const { data } = await callContract(GetUserContract, handler, { params: { id } })
 * expect(data.id).toBe(id)
 * ```
 *
 * Input is validated exactly like the real handler, and the response is
 * always validated against the contract's response schema. Throws `ApiError`
 * with the same codes the real endpoint would produce.
 */
export async function callContract<C extends AnyApiContract>(
  contract: C,
  handler: ContractHandler<C> | EventHandler | EventHandlerLike,
  input: {
    params?: Record<string, unknown>
    query?: Record<string, unknown>
    body?: unknown
    headers?: Record<string, string>
  } = {},
): Promise<{ data: ContractClientResponse<C>, error: null } | { data: null, error: ApiError }> {
  const runHandler = extractHandler(contract, handler)

  try {
    const params = contract.params
      ? validateContractInput(contract, 'params', contract.params, input.params ?? {}) as Record<string, unknown>
      : input.params ?? {}

    const query = contract.query
      ? validateContractInput(contract, 'query', contract.query, input.query ?? {})
      : input.query

    const body = contract.body
      ? validateContractInput(contract, 'body', contract.body, input.body)
      : undefined

    const headers = contract.headers
      ? validateContractInput(contract, 'headers', contract.headers, input.headers ?? {}) as Record<string, string>
      : input.headers ?? {}

    const event = createFakeEvent(headers)
    const rawResponse: unknown = await runHandler({ params, query, body, headers, event })

    const data = contract.response
      ? validateContractResponse(contract, contract.response, rawResponse) as ContractClientResponse<C>
      : rawResponse as ContractClientResponse<C>

    recordCoverageCall(contract, true)
    return { data, error: null }
  } catch (error) {
    recordCoverageCall(contract, false)
    return {
      data: null,
      error: error instanceof ApiError ? error : new ApiError({ code: 'INTERNAL_ERROR', message: String(error) }),
    }
  }
}

type EventHandlerLike = (ctx: Record<string, unknown>) => Awaitable<unknown>

/** Extracts the original handler from a `defineContractHandler` result or accepts a plain function. */
function extractHandler<C extends AnyApiContract>(contract: C, handler: unknown): ContractHandlerMeta['handler'] {
  const meta = (handler as InternalContractHandler)[CONTRACT_HANDLER_META]
  if (meta && meta.contract.path === contract.path && meta.contract.method === contract.method) {
    return meta.handler
  }
  if (typeof handler === 'function') {
    return handler as ContractHandlerMeta['handler']
  }
  throw new Error('[nuxt-api-contract] callContract requires a contract handler function')
}

/** Builds a minimal fake H3Event (documented boundary cast). */
function createFakeEvent(headers: Record<string, string>): H3Event {
  return {
    context: {
      params: {},
    },
    node: {
      req: {
        headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
      },
    },
  } as unknown as H3Event
}

/** Exposed so the module-level `defineContractHandler` can attach metadata. */
export const contractHandlerMetaKey = CONTRACT_HANDLER_META
export type { ContractHandlerResponse }

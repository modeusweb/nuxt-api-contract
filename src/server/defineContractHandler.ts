import type { EventHandler, H3Event } from 'h3'
import { defineEventHandler, getQuery, getRequestHeaders, readValidatedBody, setResponseStatus } from 'h3'
import type { z } from 'zod'
import type { AnyApiContract, MaybePromise, ContractHandlerResponse  } from '../runtime/shared/types'

import { ApiError, BUILT_IN_ERROR_CODES, createApiError, serializeApiError } from '../runtime/shared/errors'
import type { ApiErrorPayload } from '../runtime/shared/errors'
import { getContractMock } from '../runtime/shared/contract'
import {
  readRuntimeConfig,
  shouldValidateResponse,
  validateContractInput,
  validateContractResponse,
} from './validation'
import type { ContractHandlerMeta } from '../testing/callContract'

const CONTRACT_HANDLER_META = Symbol.for('nuxt-api-contract.contractHandlerMeta')

type Infer<T> = T extends z.ZodType ? z.infer<T> : never

/**
 * Context handed to contract handlers. All data is already validated.
 */
export interface ContractHandlerContext<
  TParams = Record<string, unknown>,
  TQuery = Record<string, unknown>,
  TBody = undefined,
  THeaders = Record<string, string>,
> {
  params: TParams
  query: TQuery
  body: TBody
  headers: THeaders
  /** Raw h3 event, for status codes, cookies, auth, etc. */
  event: H3Event
  /** Reserved for auth integrations (populated by middleware/plugins). */
  user?: unknown
}

export type ContractHandler<C extends AnyApiContract> = (
  ctx: ContractHandlerContext<
    C['params'] extends z.ZodType ? Infer<C['params']> : Record<string, unknown>,
    C['query'] extends z.ZodType ? Infer<C['query']> : Record<string, unknown>,
    C['body'] extends z.ZodType ? Infer<C['body']> : undefined,
    C['headers'] extends z.ZodType ? Infer<C['headers']> : Record<string, string>
  >,
) => MaybePromise<ContractHandlerResponse<C>>

/**
 * Defines a Nitro event handler bound to a contract:
 *
 * 1. validates `params`, `query`, `body` and `headers` against the schemas;
 * 2. invokes the handler with the validated (typed) data;
 * 3. optionally validates the response (see `apiContract.validateResponse`);
 * 4. converts thrown `ApiError`s into the unified error payload.
 *
 * ```ts
 * export default defineContractHandler(GetUser, async ({ params }) => {
 *   return { id: params.id, name: 'John' }
 * })
 * ```
 */
export function defineContractHandler<C extends AnyApiContract>(
  contract: C,
  handler: ContractHandler<C>,
): EventHandler {
  type TParams = C['params'] extends z.ZodType ? z.infer<C['params']> : Record<string, unknown>
  type TQuery = C['query'] extends z.ZodType ? z.infer<C['query']> : Record<string, unknown>
  type TBody = C['body'] extends z.ZodType ? z.infer<C['body']> : undefined
  type THeaders = C['headers'] extends z.ZodType ? z.infer<C['headers']> : Record<string, string>

  const eventHandler = defineEventHandler(async (event: H3Event) => {
    try {
      // --- headers (validated as a plain string record) ---
      let headers: THeaders
      if (contract.headers) {
        const raw: Record<string, string> = {}
        for (const [key, value] of Object.entries(getRequestHeaders(event))) {
          if (typeof value === 'string') raw[key] = value
        }
        headers = validateContractInput(contract, 'headers', contract.headers, raw) as THeaders
      } else {
        headers = getRequestHeaders(event) as THeaders
      }

      // --- params (route params are always strings; the schema may refine) ---
      let params: TParams
      if (contract.params) {
        const routeParams = event.context.params ?? {}
        params = validateContractInput(contract, 'params', contract.params, routeParams) as TParams
      } else {
        params = (event.context.params ?? {}) as TParams
      }

      // --- query ---
      let query: TQuery
      if (contract.query) {
        query = validateContractInput(contract, 'query', contract.query, getQuery(event)) as TQuery
      } else {
        query = getQuery(event) as TQuery
      }

      // --- body ---
      let body: TBody
      if (contract.body) {
        const rawBody = await readValidatedBody(event, value => value)
        body = validateContractInput(contract, 'body', contract.body, rawBody) as TBody
      } else if (contract.method !== 'GET' && contract.method !== 'HEAD') {
        body = (await readValidatedBody(event, value => value)) as TBody
      } else {
        body = undefined as TBody
      }

      const ctx: ContractHandlerContext<TParams, TQuery, TBody, THeaders> = {
        params,
        query,
        body,
        headers,
        event,
      }

      // --- mocks (module option `apiContract.mocks`) ---
      const runtimeConfig = readRuntimeConfig(() => useNitroRuntimeConfig(event))
      const mock = getContractMock(contract)
      if (runtimeConfig.mocks && mock?.response) {
        const mocked = await mock.response()
        return finalize(contract, mocked, runtimeConfig)
      }

      const result = await handler(ctx as Parameters<typeof handler>[0])
      return finalize(contract, result, runtimeConfig)
    } catch (error) {
      return respondWithError(event, error)
    }
  })

  // Expose metadata for `callContract` / DevTools / registry tooling.
  const withMeta = eventHandler as typeof eventHandler & { [CONTRACT_HANDLER_META]?: unknown }
  withMeta[CONTRACT_HANDLER_META] = { contract, handler: handler as unknown as ContractHandlerMeta['handler'] }

  return eventHandler
}

/** Reads Nitro runtime config from the event, tolerating different Nitro internals. */
function useNitroRuntimeConfig(event: H3Event): unknown {
  const ctx = event.context as { nitro?: { runtimeConfig?: unknown }, _nitro?: { runtimeConfig?: unknown }, $config?: unknown }
  return ctx.nitro?.runtimeConfig ?? ctx._nitro?.runtimeConfig ?? ctx.$config
}

function finalize<C extends AnyApiContract>(
  contract: C,
  result: unknown,
  runtimeConfig: ReturnType<typeof readRuntimeConfig>,
): unknown {
  if (contract.response && shouldValidateResponse(runtimeConfig.validateResponse)) {
    return validateContractResponse(contract, contract.response, result)
  }
  return result
}

/** Produces the unified error payload with the proper status code. */
function respondWithError(event: H3Event, error: unknown): ApiErrorPayload {
  if (error instanceof ApiError) {
    setResponseStatus(event, error.statusCode, error.code)
    return serializeApiError(error)
  }
  setResponseStatus(event, 500, BUILT_IN_ERROR_CODES.internal)
  return {
    error: {
      code: BUILT_IN_ERROR_CODES.internal,
      message: 'Internal server error',
    },
  }
}

export { createApiError }

import { useAsyncData, useNuxtApp, useRequestEvent } from '#imports'
import type { AsyncData } from '#app'
import type {
  AnyApiContract,
  ApiRequestOptions,
  ContractClientResponse,
} from '../runtime/shared/types'
import type { ApiError } from '../runtime/shared/errors'
import { isExternalContract } from '../runtime/shared/contract'
import { createRequestKey, executeContractRequest, toContractError } from './transport'
import type { ContractFetch, ExecuteRequestContext, ResolveFetch } from './transport'

export type { ContractFetch, ExecuteRequestContext, ResolveFetch }

export interface UseApiClientOptions {
  /**
   * Pluggable transport for external API contracts (0.5.0): a function that
   * receives the resolved URL + request init and returns the parsed response.
   * When omitted, Nuxt `$fetch` (ofetch) is used for external calls.
   */
  transport?: ContractFetch
}

/**
 * Executes a contract request and returns the typed response.
 * Intended for actions, Pinia stores, background jobs and composables where
 * a reactive `AsyncData` wrapper is not needed. Throws `ApiError` on failure.
 */
export async function useApiClient(options?: UseApiClientOptions): Promise<{
  request: <C extends AnyApiContract>(
    contract: C,
    options?: ApiRequestOptions<C>,
  ) => Promise<ContractClientResponse<C>>
  tryRequest: <C extends AnyApiContract>(
    contract: C,
    options?: ApiRequestOptions<C>,
  ) => Promise<{ data: ContractClientResponse<C>, error: ApiError | null }>
}> {
  const nuxtApp = useNuxtApp()
  const event = import.meta.server ? useRequestEvent() : undefined

  const resolveFetch: ResolveFetch = (contract) => {
    if (options?.transport && isExternalContract(contract)) {
      return options.transport
    }
    if (event && !isExternalContract(contract)) {
      // SSR: call the Nitro route internally, avoiding a full HTTP round-trip.
      // `event.$fetch` is provided by Nitro; typed through a documented boundary.
      const internalFetch = (event as unknown as { $fetch: (url: string, init: Record<string, unknown>) => Promise<unknown> }).$fetch
      return (url, init) => internalFetch(url, init)
    }
    // External contracts (and browser requests) go over HTTP via Nuxt `$fetch`,
    // which resolves absolute URLs natively in both environments.
    return (url, init) => (nuxtApp.$fetch as unknown as (url: string, init: Record<string, unknown>) => Promise<unknown>)(url, init)
  }

  const doFetch: ExecuteRequestContext['fetch'] = resolveFetch

  return {
    request: (contract, options) => executeContractRequest(contract, options, doFetch),
    tryRequest: async (contract, options) => {
      try {
        const data = await executeContractRequest(contract, options, doFetch)
        return { data, error: null }
      } catch (error) {
        return { data: undefined as ContractClientResponse<typeof contract>, error: toContractError(error) }
      }
    },
  }
}

/**
 * Type-safe reactive API composable.
 *
 * ```ts
 * const { data, error, pending, refresh } = await useApi(GetUser, {
 *   params: { id: userId },
 * })
 * ```
 *
 * - `data` is typed from the contract's `response` schema.
 * - Invalid `params` / `query` / `body` are TypeScript errors.
 * - During SSR the request is routed through Nitro internally (no HTTP hop),
 *   the payload is transferred to the client, so there is no hydration mismatch.
 */
export function useApi<C extends AnyApiContract>(
  contract: C,
  options?: ApiRequestOptions<C>,
): AsyncData<ContractClientResponse<C>, ApiError> {
  const key = createRequestKey(contract, options as ApiRequestOptions<AnyApiContract> | undefined)

  const result = useAsyncData<ContractClientResponse<C>, ApiError>(
    key,
    async () => {
      const client = await useApiClient()
      return client.request(contract, options)
    },
    { deep: false, dedupe: 'defer' },
  )

  return result as AsyncData<ContractClientResponse<C>, ApiError>
}

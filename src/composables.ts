/**
 * Composables entry: requires the Nuxt app context (`#imports`).
 * Auto-imported by the module; can also be imported explicitly:
 *
 * ```ts
 * import { useApi, useApiClient } from 'nuxt-api-contract/composables'
 * ```
 *
 * Contracts must NOT be imported from this entry — use
 * `nuxt-api-contract/client`, which stays loadable outside Nuxt (build-time
 * OpenAPI generation, unit tests, tooling).
 */
export { useApi, useApiClient } from './client/useApi'
export type { ExecuteRequestContext } from './client/transport'

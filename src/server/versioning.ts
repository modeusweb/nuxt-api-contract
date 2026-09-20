/**
 * Server-only contract versioning (0.6.0):
 * - `defineVersionedHandlers` — version negotiation over one Nitro route:
 *   picks the handler matching `x-api-version` header or `?v=` query,
 *   falling back to a default version;
 * - `resolveRequestedApiVersion` — extracts the requested version from an h3 event.
 */
import type { EventHandler, H3Event } from 'h3'
import { defineEventHandler, getQuery, getRequestHeader, setResponseStatus } from 'h3'
import { ApiError, serializeApiError } from '../runtime/shared/errors'
import { getDeprecationHeaders, isDeprecatedContract } from '../runtime/shared/versioning'

/** HTTP header accepted for API version negotiation. */
export const API_VERSION_HEADER = 'x-api-version'

/** Query parameter accepted for API version negotiation. */
export const API_VERSION_QUERY = 'v'

/**
 * Reads the requested API version from an event:
 * 1. `x-api-version` header;
 * 2. `?v=` query parameter.
 * Returns `undefined` when neither is present or the value is not a positive
 * integer.
 */
export function resolveRequestedApiVersion(event: H3Event): number | undefined {
  const headerValue = getRequestHeader(event, API_VERSION_HEADER)
  if (headerValue) {
    const parsed = Number.parseInt(headerValue, 10)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  const query = getQuery(event) as { v?: unknown }
  const rawQuery = query.v
  if (typeof rawQuery === 'string' || typeof rawQuery === 'number') {
    const parsed = Number.parseInt(String(rawQuery), 10)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return undefined
}

export interface VersionedHandlerEntry {
  /** Version served by this handler. */
  version: number
  /** Handler produced by `defineContractHandler` (or any event handler). */
  handler: EventHandler
  /**
   * Marks the version as deprecated: `Deprecation` / `Sunset` headers are
   * attached to successful responses.
   */
  deprecated?: boolean | { sunset?: string, message?: string, since?: number }
}

export interface VersionedHandlersOptions {
  /** Version served when the client does not request one. Defaults to the highest version. */
  defaultVersion?: number
  /**
   * When true, a requested version without a matching handler falls back to
   * the closest lower version (backward compatible). Defaults to true.
   */
  fallback?: boolean
}

/**
 * Serves multiple contract versions over a single Nitro route:
 *
 * ```ts
 * // server/api/users/[id].get.ts
 * export default defineVersionedHandlers([
 *   { version: 1, handler: defineContractHandler(GetUserV1, v1Handler), deprecated: true },
 *   { version: 2, handler: defineContractHandler(GetUserV2, v2Handler) },
 * ], { defaultVersion: 2 })
 * ```
 *
 * The client selects a version with the `x-api-version` header or `?v=2`.
 * Unknown versions respond with `404 VERSION_NOT_FOUND`.
 */
export function defineVersionedHandlers(
  versions: readonly VersionedHandlerEntry[],
  options: VersionedHandlersOptions = {},
): EventHandler {
  if (versions.length === 0) {
    throw new Error('[nuxt-api-contract] defineVersionedHandlers: at least one version is required')
  }

  const sorted = [...versions].sort((a, b) => a.version - b.version)
  const byVersion = new Map(sorted.map(entry => [entry.version, entry]))
  const highest = sorted[sorted.length - 1]!.version
  const defaultVersion = options.defaultVersion ?? highest

  if (!byVersion.has(defaultVersion)) {
    throw new Error(
      `[nuxt-api-contract] defineVersionedHandlers: defaultVersion ${defaultVersion} has no handler (available: ${sorted.map(entry => entry.version).join(', ')})`,
    )
  }

  return defineEventHandler(async (event: H3Event) => {
    const requested = resolveRequestedApiVersion(event)
    const version = requested ?? defaultVersion

    let entry = byVersion.get(version)
    if (!entry) {
      if (options.fallback !== false) {
        // Backward-compatible fallback: closest version <= requested.
        const candidates = sorted.filter(candidate => candidate.version <= version)
        entry = candidates.length > 0 ? candidates[candidates.length - 1] : sorted[0]
      } else {
        entry = undefined
      }
    }

    if (!entry) {
      setResponseStatus(event, 404, 'VERSION_NOT_FOUND')
      return serializeApiError(new ApiError({
        code: 'VERSION_NOT_FOUND',
        message: `API version ${version} is not available (available: ${sorted.map(available => available.version).join(', ')})`,
        statusCode: 404,
      }))
    }

    const result = await entry.handler(event)

    // Attach deprecation headers when the served version is deprecated.
    if (entry.deprecated) {
      for (const [header, value] of Object.entries(getDeprecationHeaders({ deprecated: entry.deprecated }))) {
        event.node.res.setHeader(header, value)
      }
    }

    return result
  })
}

/** Re-exported for convenience in handlers that inspect deprecation inline. */
export { getDeprecationHeaders, isDeprecatedContract }

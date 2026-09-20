/**
 * Contract versioning helpers (0.6.0):
 * - `versionedPath` — type-safe `/api/vN` path prefixing;
 * - registry helpers to list / select contract versions;
 * - deprecation header construction.
 * Client-safe: no server-only imports.
 */
import type { AnyApiContract, DeprecationInfo } from './types'
import { listRegisteredContracts } from './contract'

/* ------------------------------------------------------------------ *
 * versionedPath
 * ------------------------------------------------------------------ */

/**
 * Prefixes a contract path with an API version segment:
 * `versionedPath(2, '/api/users/:id')` -> `/api/v2/users/:id`.
 *
 * The return type is a template literal, so path-parameter inference keeps
 * working through `PathParams` when used inside `defineApiContract`.
 */
export function versionedPath<const TVersion extends number, const TPath extends string>(
  version: TVersion,
  path: TPath,
): `/api/v${TVersion}${TPath}` {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`[nuxt-api-contract] versionedPath: version must be a positive integer, received ${version}`)
  }
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `/api/v${version}${suffix}` as `/api/v${TVersion}${TPath}`
}

/** True when the (absolute) path already contains a `/v<digits>` segment. */
export function hasVersionedPath(path: string): boolean {
  return /(?:^|\/)v\d+(?:\/|$)/.test(path)
}

/* ------------------------------------------------------------------ *
 * Registry version helpers
 * ------------------------------------------------------------------ */

/** All registered contracts with the given name, sorted by version (oldest first). */
export function listContractVersions(name: string): AnyApiContract[] {
  return listRegisteredContracts()
    .filter(contract => contract.name === name)
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0))
}

/**
 * Selects a specific version of a named contract. When `version` is omitted
 * the latest registered version is returned.
 */
export function getContractVersion(name: string, version?: number): AnyApiContract | undefined {
  const versions = listContractVersions(name)
  if (versions.length === 0) return undefined
  if (version === undefined) return versions[versions.length - 1]
  return versions.find(contract => contract.version === version)
}

/**
 * Version negotiation: picks the best registered contract version for the
 * requested version. Exact match wins; otherwise the highest version that is
 * still <= requested (backward compatible); otherwise the oldest available.
 */
export function negotiateContractVersion(name: string, requested: number): AnyApiContract | undefined {
  const versions = listContractVersions(name)
  if (versions.length === 0) return undefined
  const exact = versions.find(contract => contract.version === requested)
  if (exact) return exact
  const compatible = versions.filter(contract => (contract.version ?? 0) <= requested)
  return compatible.length > 0 ? compatible[compatible.length - 1] : versions[0]
}

/* ------------------------------------------------------------------ *
 * Deprecation
 * ------------------------------------------------------------------ */

/** Normalizes the `deprecated` definition field into `DeprecationInfo | undefined`. */
export function normalizeDeprecation(deprecated: boolean | DeprecationInfo | undefined): DeprecationInfo | undefined {
  if (deprecated === undefined || deprecated === false) return undefined
  if (deprecated === true) return {}
  return deprecated
}

/**
 * Builds the standard deprecation response headers for a contract:
 * - `Deprecation: true` (or `@<since>` when a since version is known);
 * - `Sunset: <http-date>` when a sunset date is provided;
 * - `Warning: 299 - "<message>"` when a migration message is provided.
 */
export function getDeprecationHeaders(
  contract: Pick<AnyApiContract, 'deprecated'>,
): Record<string, string> {
  const info = normalizeDeprecation(contract.deprecated)
  if (!info) return {}
  const headers: Record<string, string> = { Deprecation: info.since !== undefined ? `@${info.since}` : 'true' }
  if (info.sunset) headers.Sunset = info.sunset
  if (info.message) headers.Warning = `299 - "${info.message}"`
  return headers
}

/** True when the contract carries deprecation metadata. */
export function isDeprecatedContract(contract: Pick<AnyApiContract, 'deprecated'>): boolean {
  return contract.deprecated !== undefined && contract.deprecated !== false
}

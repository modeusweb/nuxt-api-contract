/**
 * Serialization helpers shared by the client transport and cache keys.
 *
 * The protocol intentionally stays minimal: standard JSON plus two common
 * edge cases (Date and bigint). Response serialization relies on Nitro's
 * built-in devalue support, which already handles Date, RegExp, etc.
 */

/** Converts query values into URL-safe primitives (Date -> ISO, bigint -> string). */
export type SerializedQueryValue = string | number | boolean | Array<string | number | boolean>

export function serializeQueryValue(value: unknown): SerializedQueryValue {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(item => serializePrimitive(item))
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return value as string | number | boolean
}

function serializePrimitive(value: unknown): string | number | boolean {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (value === undefined || value === null || typeof value === 'object') return JSON.stringify(value) ?? ''
  return value as string | number | boolean
}

/** Prepares a query object for `$fetch` / URL building; drops `undefined` entries. */
export function serializeQuery(
  query: Record<string, unknown> | undefined,
): Record<string, SerializedQueryValue> | undefined {
  if (!query) return undefined
  const result: Record<string, SerializedQueryValue> = {}
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    result[key] = serializeQueryValue(value)
  }
  return result
}

/** Deterministic JSON stringify (sorted keys) for stable SSR cache keys. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item))
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return Object.fromEntries(entries.map(([key, item]) => [key, sortValue(item)]))
  }
  return value
}

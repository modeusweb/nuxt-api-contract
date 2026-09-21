/**
 * Server-only multipart handling: reads `multipart/form-data` requests into a
 * plain object and coerces the string values according to the body schema, so
 * `z.number()`, `z.boolean()`, `z.date()`, arrays and nested objects validate
 * exactly like they would for a JSON body.
 *
 * `z.file()` / `z.instanceof(File)` fields receive a real `File` instance when
 * the runtime provides one (Node >= 20, Workers, Nitro); otherwise a documented
 * `{ filename, type, size, data }` descriptor is passed through and the
 * validation error explains the mismatch.
 */
import { readMultipartFormData } from 'h3'
import type { H3Event } from 'h3'
import type { ZodType } from 'zod'
import { unwrapZodSchema } from '../runtime/shared/zod-schema'

/** Fallback representation of an uploaded file when `File` is unavailable. */
export interface MultipartFileDescriptor {
  filename: string
  type: string
  size: number
  data: Buffer
}

type FileLike = File | MultipartFileDescriptor

let warnedAboutFile = false

/** Resolves a `File` constructor for the current runtime, when available. */
async function resolveFileConstructor(): Promise<typeof File | undefined> {
  if (typeof globalThis.File === 'function') return globalThis.File
  try {
    const buffer = await import('node:buffer')
    return buffer.File as unknown as typeof File
  } catch {
    return undefined
  }
}

function toFormValue(part: { name?: string, filename?: string, type?: string, data: Buffer }, FileCtor: typeof File | undefined): unknown {
  if (part.filename === undefined) return part.data.toString('utf8')
  if (FileCtor) {
    // `Uint8Array.from` normalizes `Buffer<ArrayBufferLike>` into a BlobPart.
    return new FileCtor([Uint8Array.from(part.data)], part.filename, part.type ? { type: part.type } : undefined)
  }
  if (!warnedAboutFile) {
    warnedAboutFile = true
    console.warn(
      '[nuxt-api-contract] This runtime has no global `File`; uploaded files are passed as { filename, type, size, data } descriptors. '
      + 'Use a schema that accepts that shape (e.g. z.object({ filename: z.string(), data: z.instanceof(Buffer) })).',
    )
  }
  return { filename: part.filename, type: part.type ?? '', size: part.data.length, data: part.data } satisfies MultipartFileDescriptor
}

/** Groups repeated field names (and `name[]` conventions) into arrays. */
function assignField(target: Record<string, unknown>, name: string, value: unknown): void {
  const key = name.endsWith('[]') ? name.slice(0, -2) : name
  const existing = target[key]
  if (existing === undefined) {
    target[key] = value
    return
  }
  if (Array.isArray(existing)) {
    existing.push(value)
    return
  }
  target[key] = [existing, value]
}

/**
 * Reads a `multipart/form-data` body into an object.
 *
 * When `bodySchema` is provided, values are coerced against it (numbers,
 * booleans, bigints, dates, arrays, JSON-encoded nested objects and unions).
 */
export async function readMultipartBody(event: H3Event, bodySchema?: ZodType): Promise<Record<string, unknown>> {
  const parts = await readMultipartFormData(event)
  const body: Record<string, unknown> = {}
  if (!parts || parts.length === 0) return body

  const FileCtor = await resolveFileConstructor()
  for (const part of parts) {
    if (!part.name) continue
    assignField(body, part.name, toFormValue(part, FileCtor))
  }

  return bodySchema ? coerceMultipartValue(bodySchema, body) as Record<string, unknown> : body
}

/**
 * Coerces multipart string values to the types declared by the body schema.
 * Only unambiguous conversions are performed — anything else is returned
 * untouched so Zod produces an accurate validation error.
 */
export function coerceMultipartValue(schema: ZodType, value: unknown): unknown {
  const { descriptor } = unwrapZodSchema(schema)

  switch (descriptor.kind) {
    case 'number':
      if (typeof value !== 'string' || value.trim() === '') return value
      return Number.isNaN(Number(value)) ? value : Number(value)
    case 'bigint': {
      if (typeof value !== 'string' || value.trim() === '') return value
      try {
        return BigInt(value)
      } catch {
        return value
      }
    }
    case 'boolean': {
      if (typeof value !== 'string') return value
      const normalized = value.trim().toLowerCase()
      if (['true', '1', 'on', 'yes'].includes(normalized)) return true
      if (['false', '0', 'off', 'no'].includes(normalized)) return false
      return value
    }
    case 'date': {
      if (typeof value !== 'string') return value
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? value : parsed
    }
    case 'array':
    case 'set': {
      const items = Array.isArray(value) ? value : [value]
      return items.map(item => (descriptor.element ? coerceMultipartValue(descriptor.element, item) : item))
    }
    case 'object': {
      const raw = typeof value === 'string' ? tryParseJson(value) : value
      if (!isPlainObject(raw)) return value
      const result: Record<string, unknown> = { ...raw }
      for (const [key, child] of Object.entries(descriptor.shape ?? {})) {
        if (key in result) result[key] = coerceMultipartValue(child, result[key])
      }
      return result
    }
    case 'union': {
      for (const option of descriptor.options ?? []) {
        const candidate = coerceMultipartValue(option, value)
        if (option.safeParse(candidate).success) return candidate
      }
      return value
    }
    default:
      return value
  }
}

function tryParseJson(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Blob)
}

export type { FileLike }

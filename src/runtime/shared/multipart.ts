/**
 * Multipart (`multipart/form-data`) support — client-safe half.
 *
 * A contract body declared with `multipartSchema()` (or `bodyFormat:
 * 'multipart'`) is sent as `FormData` instead of JSON. The abstraction does
 * not assume JSON everywhere: `bodyFormat: 'auto'` (default) detects the
 * marker, `'json'` and `'multipart'` force a transport.
 *
 * ```ts
 * export const UploadAvatar = defineApiContract({
 *   method: 'POST',
 *   path: '/api/users/:id/avatar',
 *   params: z.object({ id: z.string() }),
 *   body: multipartSchema({
 *     file: z.file().max(2_000_000),
 *     caption: z.string().optional(),
 *   }),
 *   response: z.object({ url: z.string() }),
 * })
 * ```
 *
 * File fields are appended as-is; arrays repeat the same field name; plain
 * objects are JSON-encoded; `Date`/`bigint`/numbers/booleans are stringified.
 */
import type { ZodObject, ZodRawShape, ZodType } from 'zod'
import { z } from 'zod'

/** Marker attached to schemas created by `multipartSchema()`. */
export const MULTIPART_SCHEMA = Symbol.for('nuxt-api-contract.multipartSchema')

/** How a contract body is transported. */
export type BodyFormat = 'auto' | 'json' | 'multipart'

interface MultipartBrand {
  [MULTIPART_SCHEMA]?: true
}

/**
 * Declares a `multipart/form-data` body schema.
 *
 * Behaves like `z.object(shape)` for validation and type inference, and marks
 * the contract body so the client sends `FormData` and the server reads
 * `multipart/form-data` parts (see `nuxt-api-contract/server`).
 */
export function multipartSchema<Shape extends ZodRawShape>(shape: Shape): ZodObject<Shape> {
  const schema = z.object(shape)
  Object.defineProperty(schema, MULTIPART_SCHEMA, {
    value: true,
    enumerable: false,
    configurable: true,
  })
  return schema
}

/** True when the schema was created by `multipartSchema()`. */
export function isMultipartSchema(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return (value as MultipartBrand)[MULTIPART_SCHEMA] === true
}

/**
 * Resolves the transport for a contract body:
 * `bodyFormat` wins when set explicitly, otherwise the schema marker decides.
 */
export function resolveBodyFormat(contract: { body?: ZodType | undefined, bodyFormat?: BodyFormat | undefined }): Exclude<BodyFormat, 'auto'> {
  if (contract.bodyFormat === 'json' || contract.bodyFormat === 'multipart') return contract.bodyFormat
  return isMultipartSchema(contract.body) ? 'multipart' : 'json'
}

/* ------------------------------------------------------------------ *
 * Client-side serialization
 * ------------------------------------------------------------------ */

/** True for `File` / `Blob` values (guarded for runtimes without `Blob`). */
export function isFileLike(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

/**
 * Serializes a multipart body object into `FormData`.
 *
 * - `File` / `Blob` values are appended unchanged (the runtime adds the
 *   filename and content type);
 * - arrays append one entry per element under the same name;
 * - nested objects are JSON-encoded;
 * - `null` / `undefined` entries are skipped (the field is simply absent);
 * - `Date` -> ISO string, `bigint` -> string, numbers/booleans -> string.
 */
export function serializeMultipartBody(body: unknown): FormData {
  const form = new FormData()
  if (body && typeof body === 'object' && !isFileLike(body) && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      appendMultipartValue(form, key, value)
    }
    return form
  }
  // Non-object bodies (rare) are sent under the generic `body` field.
  appendMultipartValue(form, 'body', body)
  return form
}

function appendMultipartValue(form: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (isFileLike(value)) {
    form.append(key, value, value instanceof File ? value.name : undefined)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) appendMultipartValue(form, key, item)
    return
  }
  if (value instanceof Date) {
    form.append(key, value.toISOString())
    return
  }
  if (typeof value === 'bigint') {
    form.append(key, value.toString())
    return
  }
  if (typeof value === 'object') {
    form.append(key, JSON.stringify(value))
    return
  }
  form.append(key, String(value))
}

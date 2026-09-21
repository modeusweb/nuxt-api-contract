import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineApiContract, multipartSchema, resolveBodyFormat, serializeMultipartBody, isMultipartSchema } from '../../src/client'
import { coerceMultipartValue } from '../../src/server/multipart'

const UploadContract = defineApiContract({
  name: 'UploadAvatar',
  method: 'POST',
  path: '/api/users/:id/avatar',
  params: z.object({ id: z.string() }),
  body: multipartSchema({
    file: z.file(),
    caption: z.string().optional(),
    tags: z.array(z.string()).optional(),
    meta: z.object({ width: z.coerce.number(), height: z.coerce.number() }).optional(),
    count: z.coerce.number().optional(),
    featured: z.coerce.boolean().optional(),
  }),
  response: z.object({ url: z.string() }),
})

describe('multipartSchema', () => {
  it('behaves like z.object and carries the multipart marker', () => {
    const schema = multipartSchema({ title: z.string() })
    expect(isMultipartSchema(schema)).toBe(true)
    expect(schema.safeParse({ title: 'ok' }).success).toBe(true)
    expect(schema.safeParse({ title: 1 }).success).toBe(false)
    expect(isMultipartSchema(z.object({ title: z.string() }))).toBe(false)
  })

  it('resolves the contract body format', () => {
    expect(resolveBodyFormat(UploadContract)).toBe('multipart')
    expect(resolveBodyFormat({ body: z.object({ a: z.string() }) })).toBe('json')
    expect(resolveBodyFormat({ body: z.object({ a: z.string() }), bodyFormat: 'multipart' })).toBe('multipart')
    expect(resolveBodyFormat({ body: multipartSchema({ a: z.string() }), bodyFormat: 'json' })).toBe('json')
    // The contract stores the resolved format.
    expect(UploadContract.bodyFormat).toBe('multipart')
  })
})

describe('serializeMultipartBody', () => {
  it('builds FormData with files, arrays and JSON-encoded objects', () => {
    const file = new File(['hello'], 'avatar.png', { type: 'image/png' })
    const form = serializeMultipartBody({
      file,
      caption: 'profile photo',
      tags: ['a', 'b'],
      meta: { width: 10, height: 20 },
      count: 3,
      featured: true,
      skipped: undefined,
      nil: null,
    })

    expect(form).toBeInstanceOf(FormData)
    expect((form.get('file') as File).name).toBe('avatar.png')
    expect(form.get('caption')).toBe('profile photo')
    expect(form.getAll('tags')).toEqual(['a', 'b'])
    expect(form.get('meta')).toBe('{"width":10,"height":20}')
    expect(form.get('count')).toBe('3')
    expect(form.get('featured')).toBe('true')
    expect(form.has('skipped')).toBe(false)
    expect(form.has('nil')).toBe(false)
  })

  it('serializes Date and bigint values as strings', () => {
    const form = serializeMultipartBody({ when: new Date('2024-01-02T03:04:05.000Z'), id: 10n })
    expect(form.get('when')).toBe('2024-01-02T03:04:05.000Z')
    expect(form.get('id')).toBe('10')
  })
})

describe('coerceMultipartValue', () => {
  it('coerces primitives declared by the schema', () => {
    expect(coerceMultipartValue(z.number(), '42')).toBe(42)
    expect(coerceMultipartValue(z.coerce.number(), '42')).toBe(42)
    expect(coerceMultipartValue(z.boolean(), 'true')).toBe(true)
    expect(coerceMultipartValue(z.boolean(), 'off')).toBe(false)
    expect(coerceMultipartValue(z.bigint(), '10')).toBe(10n)
    expect(coerceMultipartValue(z.string(), 'kept')).toBe('kept')
  })

  it('keeps values that cannot be coerced so Zod reports an accurate error', () => {
    expect(coerceMultipartValue(z.number(), 'abc')).toBe('abc')
    expect(coerceMultipartValue(z.boolean(), 'maybe')).toBe('maybe')
    expect(coerceMultipartValue(z.bigint(), 'nope')).toBe('nope')
  })

  it('handles arrays, nested objects and JSON-encoded objects', () => {
    expect(coerceMultipartValue(z.array(z.number()), ['1', '2'])).toEqual([1, 2])
    expect(coerceMultipartValue(z.array(z.number()), '7')).toEqual([7])
    expect(coerceMultipartValue(z.object({ width: z.number() }), { width: '10' })).toEqual({ width: 10 })
    expect(coerceMultipartValue(z.object({ width: z.number() }), '{"width":"10"}')).toEqual({ width: 10 })
    expect(coerceMultipartValue(z.date(), '2024-01-01T00:00:00.000Z')).toEqual(new Date('2024-01-01T00:00:00.000Z'))
  })

  it('picks the first union member that validates', () => {
    const disjoint = z.union([z.number(), z.string()])
    expect(coerceMultipartValue(disjoint, '5')).toBe(5)
    expect(coerceMultipartValue(disjoint, 'abc')).toBe('abc')

    // `'true'` cannot be a number, so coercion falls through to the boolean
    // member instead of leaving the raw string for Zod.
    const numericFirst = z.union([z.coerce.number(), z.coerce.boolean()])
    expect(coerceMultipartValue(numericFirst, '12')).toBe(12)
    expect(coerceMultipartValue(numericFirst, 'true')).toBe(true)
  })

  it('passes File values through untouched', () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' })
    expect(coerceMultipartValue(z.file(), file)).toBe(file)
  })

  it('produces a body that satisfies the multipart schema', () => {
    const raw = {
      file: new File(['x'], 'a.txt', { type: 'text/plain' }),
      count: '5',
      featured: 'false',
      tags: ['a'],
      meta: '{"width":"1","height":"2"}',
    }
    const coerced = coerceMultipartValue(UploadContract.body as z.ZodType, raw)
    const parsed = (UploadContract.body as z.ZodType).safeParse(coerced)
    expect(parsed.success).toBe(true)
    expect((coerced as { count: number }).count).toBe(5)
    expect((coerced as { featured: boolean }).featured).toBe(false)
    expect((coerced as { meta: { width: number } }).meta.width).toBe(1)
  })
})

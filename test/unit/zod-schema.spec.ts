import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { describeZodSchema, isObjectSchema, unwrapZodSchema } from '../../src/runtime/shared/zod-schema'

/**
 * The introspection layer must behave identically for Zod 3 and Zod 4.
 * Zod 4 ships a Zod 3 build at `zod/v3`, which lets a single install verify
 * both majors. Zod 3 installs have no `zod/v3` subpath — those expectations
 * are skipped, and only the installed major is exercised.
 */
let z3: typeof z | null = null

beforeAll(async () => {
  try {
    const mod = await import(/* @vite-ignore */ 'zod/v3')
    // `zod/v3` ships Zod 3 typings, which are intentionally incompatible with
    // the Zod 4 typings used by the rest of this file: the module is only
    // exercised at runtime here.
    z3 = (mod as unknown as { z: typeof z }).z
  } catch {
    z3 = null
  }
})

type AnyZ = typeof z

function majors(): Array<['zod4' | 'zod3', AnyZ]> {
  const list: Array<['zod4' | 'zod3', AnyZ]> = [['zod4', z as AnyZ]]
  if (z3) list.push(['zod3', z3 as AnyZ])
  return list
}

function checkSummary(schema: unknown): string {
  return describeZodSchema(schema as never).checks
    .map((check) => {
      const format = check.format ? `:${check.format}` : ''
      const value = check.value !== undefined ? `=${String(check.value)}` : ''
      return `${check.kind}${format}${value}`
    })
    .join(',')
}

describe('describeZodSchema', () => {
  it('normalizes scalar kinds', () => {
    for (const [name, Z] of majors()) {
      expect(describeZodSchema(Z.string()).kind, name).toBe('string')
      expect(describeZodSchema(Z.number()).kind, name).toBe('number')
      expect(describeZodSchema(Z.bigint()).kind, name).toBe('bigint')
      expect(describeZodSchema(Z.boolean()).kind, name).toBe('boolean')
      expect(describeZodSchema(Z.date()).kind, name).toBe('date')
      expect(describeZodSchema(Z.null()).kind, name).toBe('null')
      expect(describeZodSchema(Z.array(Z.string())).kind, name).toBe('array')
      expect(describeZodSchema(Z.record(Z.string(), Z.string())).kind, name).toBe('record')
      expect(describeZodSchema(Z.union([Z.string(), Z.number()])).kind, name).toBe('union')
      expect(describeZodSchema(Z.tuple([Z.string(), Z.number()])).kind, name).toBe('tuple')
      expect(describeZodSchema(Z.object({ a: Z.string() })).kind, name).toBe('object')
    }
  })

  it('normalizes string checks', () => {
    for (const [name, Z] of majors()) {
      expect(checkSummary(Z.string().email().min(3).max(9)), name).toBe('format:email,min=3,max=9')
      expect(checkSummary(Z.string().uuid()), name).toBe('format:uuid')
      expect(checkSummary(Z.string().url()), name).toBe('format:url')
      expect(checkSummary(Z.string().length(4)), name).toBe('length=4')
      expect(describeZodSchema(Z.string().regex(/^a+$/)).checks.find(check => check.kind === 'regex')?.pattern, name).toBe('^a+$')
    }
  })

  it('normalizes number checks', () => {
    for (const [name, Z] of majors()) {
      expect(checkSummary(Z.number().int().min(1).max(10).multipleOf(2)), name).toBe('int,min=1,max=10,multipleOf=2')
      expect(checkSummary(Z.number().positive()), name).toBe('min=0')
      expect(describeZodSchema(Z.coerce.number()).coerce, name).toBe(true)
    }
  })

  it('normalizes arrays, sets and tuples', () => {
    for (const [name, Z] of majors()) {
      const array = describeZodSchema(Z.array(Z.string()).min(2).max(4))
      expect(array.kind, name).toBe('array')
      expect(describeZodSchema(array.element!).kind, name).toBe('string')
      expect(checkSummary(Z.array(Z.string()).min(2).max(4)), name).toBe('min=2,max=4')
      expect(describeZodSchema(Z.tuple([Z.string(), Z.number()])).items?.length, name).toBe(2)
      expect(describeZodSchema(Z.set(Z.string())).kind, name).toBe('set')
    }
  })

  it('normalizes literals, enums and native enums', () => {
    for (const [name, Z] of majors()) {
      expect(describeZodSchema(Z.literal('x')).values, name).toEqual(['x'])
      expect(describeZodSchema(Z.literal(42)).values, name).toEqual([42])
      expect(describeZodSchema(Z.enum(['a', 'b'])).values, name).toEqual(['a', 'b'])
      expect(describeZodSchema(Z.nativeEnum({ A: 'a' })).values, name).toEqual(['a'])
    }
  })

  it('normalizes objects with unknown-key policies', () => {
    for (const [name, Z] of majors()) {
      expect(Object.keys(describeZodSchema(Z.object({ a: Z.string() })).shape ?? {}), name).toEqual(['a'])
      expect(describeZodSchema(Z.object({ a: Z.string() })).unknownKeys, name).toBe('strip')
      expect(describeZodSchema(Z.strictObject({ a: Z.string() })).unknownKeys, name).toBe('strict')
      expect(describeZodSchema(Z.object({ a: Z.string() }).passthrough()).unknownKeys, name).toBe('passthrough')
    }
  })

  it('reports refinements and transforms', () => {
    for (const [name, Z] of majors()) {
      const refined = describeZodSchema(Z.string().refine(value => value.length > 1))
      expect(refined.checks.some(check => check.kind === 'refinement'), name).toBe(true)

      const transformed = describeZodSchema(Z.string().transform(value => value.length))
      expect(transformed.kind, name).toBe('pipe')
      expect(transformed.effect, name).toBe('transform')
      expect(describeZodSchema(transformed.input!).kind, name).toBe('string')

      const preprocessed = describeZodSchema(Z.preprocess(value => String(value), Z.string()))
      expect(preprocessed.kind, name).toBe('pipe')
      expect(preprocessed.effect, name).toBe('preprocess')
    }
  })

  it('reads descriptions across majors', () => {
    for (const [name, Z] of majors()) {
      expect(describeZodSchema(Z.string().describe('hello')).description, name).toBe('hello')
    }
  })
})

describe('unwrapZodSchema', () => {
  it('collects optional / nullable / default metadata', () => {
    for (const [name, Z] of majors()) {
      const optional = unwrapZodSchema(Z.string().optional())
      expect(optional.optional, name).toBe(true)
      expect(optional.descriptor.kind, name).toBe('string')

      expect(unwrapZodSchema(Z.string().nullable()).nullable, name).toBe(true)

      const withDefault = unwrapZodSchema(Z.number().default(10))
      expect(withDefault.hasDefault, name).toBe(true)
      expect(withDefault.descriptor.kind, name).toBe('number')

      const nullish = unwrapZodSchema(Z.string().nullish())
      expect(nullish.optional, name).toBe(true)
      expect(nullish.nullable, name).toBe(true)

      expect(unwrapZodSchema(Z.lazy(() => Z.string())).descriptor.kind, name).toBe('string')
    }
  })

  it('detects object schemas through wrappers', () => {
    for (const [name, Z] of majors()) {
      expect(isObjectSchema(Z.object({ a: Z.string().optional() })), name).toBe(true)
      expect(isObjectSchema(Z.string()), name).toBe(false)
    }
  })
})


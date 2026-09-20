/**
 * Deterministic mock-data generation from contract schemas (client-safe:
 * only depends on zod). Used by `autoMockContract`, the `apiContract.mocks:
 * 'auto'` mode and the standalone mock server.
 */
import type { ZodType } from 'zod'
import type { AnyApiContract, ContractHandlerResponse } from './types'
import { mockContract, type ContractMock } from './contract'

export interface MockGenerateOptions {
  /** Seed for deterministic generation (default: 42). */
  seed?: number
}

interface RngContext {
  rng: () => number
  depth: number
}

interface MockZodDef {
  typeName?: string
  shape?: Record<string, ZodType> | (() => Record<string, ZodType>)
  innerType?: ZodType
  schema?: ZodType
  options?: ZodType[]
  value?: unknown
  values?: unknown[]
  items?: ZodType[]
  valueType?: ZodType
  type?: ZodType
  checks?: Array<{ kind?: string, value?: unknown }>
  effect?: { type?: string }
  left?: ZodType
  right?: ZodType
  defaultValue?: unknown
}

function zodDef(schema: ZodType): MockZodDef {
  return (schema as unknown as { _def: MockZodDef })._def
}

/** Mulberry32 — small, fast, deterministic PRNG. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0
  return function () {
    state = (state + 0x6D2B79F5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function strHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length) % items.length]!
}

function intBetween(rng: () => number, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1))
}

const FIRST_NAMES = ['John', 'Jane', 'Alex', 'Maria', 'Ivan', 'Elena']
const LAST_NAMES = ['Doe', 'Smith', 'Brown', 'Ivanov', 'Miller']
const WORDS = ['mock', 'demo', 'sample', 'alpha', 'beta', 'gamma']

/** Fixed epoch so generated dates are deterministic. */
const MOCK_EPOCH = Date.UTC(2024, 0, 1)
const YEAR_MS = 365 * 24 * 3600 * 1000

function mockUuid(rng: () => number): string {
  const hex = () => Math.floor(rng() * 0xFFFF).toString(16).padStart(4, '0')
  return `${hex()}${hex()}-4${hex().slice(1)}-8${hex().slice(1)}-4${hex().slice(1)}-${hex()}${hex()}${hex()}`
}

/** Generates a plausible string for a field, guided by its name and checks. */
function mockString(key: string, def: MockZodDef, ctx: RngContext): string {
  const lower = key.toLowerCase()
  const checks = def.checks ?? []
  const check = (kind: string) => checks.find(c => c.kind === kind)?.value as number | undefined
  const format = checks.find(c => c.kind === 'format')?.value as string | undefined
  const hasCheck = (kind: string) => checks.some(c => c.kind === kind)

  let value: string
  if (format === 'email' || hasCheck('email') || lower.includes('email')) {
    const name = pick(FIRST_NAMES, ctx.rng).toLowerCase()
    value = `${name}.${pick(LAST_NAMES, ctx.rng).toLowerCase()}@example.com`
  } else if (hasCheck('uuid')) {
    value = mockUuid(ctx.rng)
  } else if (hasCheck('datetime') || lower === 'createdat' || lower === 'updatedat' || lower.endsWith('date') || lower.endsWith('_at')) {
    value = new Date(MOCK_EPOCH - Math.floor(ctx.rng() * YEAR_MS)).toISOString()
  } else if (hasCheck('url') || lower.endsWith('url') || lower.endsWith('link')) {
    value = `https://example.com/${pick(WORDS, ctx.rng)}/${intBetween(ctx.rng, 1, 999)}`
  } else if (lower.includes('phone') || lower.includes('tel')) {
    value = `+1 555 010 ${intBetween(ctx.rng, 1000, 9999)}`
  } else if (lower === 'id' || lower.endsWith('_id') || lower.endsWith('id')) {
    value = `id-${intBetween(ctx.rng, 1, 99999)}`
  } else if (lower.includes('slug')) {
    value = `${pick(WORDS, ctx.rng)}-${intBetween(ctx.rng, 1, 999)}`
  } else if (lower === 'name' || lower.endsWith('name')) {
    value = `${pick(FIRST_NAMES, ctx.rng)} ${pick(LAST_NAMES, ctx.rng)}`
  } else if (lower === 'title') {
    value = `${pick(WORDS, ctx.rng)} title`
  } else if (lower.includes('password') || lower.includes('token') || lower.includes('secret')) {
    // Never generate realistic-looking credentials, even in mocks.
    value = '********'
  } else if (lower.includes('description') || lower === 'bio' || lower === 'text') {
    value = `Mock ${pick(WORDS, ctx.rng)} description for automated testing.`
  } else {
    value = `${pick(WORDS, ctx.rng)}-${intBetween(ctx.rng, 1, 9999)}`
  }

  const minLength = check('min')
  if (minLength !== undefined) {
    while (value.length < minLength) value += '-filler'
  }
  const maxLength = check('max')
  if (maxLength !== undefined && value.length > maxLength) {
    value = value.slice(0, maxLength)
  }
  return value
}

function mockNumber(def: MockZodDef, ctx: RngContext): number {
  const checks = def.checks ?? []
  const isInt = checks.some(c => c.kind === 'int')
  const min = (checks.find(c => c.kind === 'min')?.value as number | undefined) ?? 1
  const max = (checks.find(c => c.kind === 'max')?.value as number | undefined) ?? 100
  const multipleOf = checks.find(c => c.kind === 'multipleOf')?.value as number | undefined
  if (multipleOf !== undefined && multipleOf > 0) {
    const minMul = Math.max(1, Math.ceil(min / multipleOf))
    const maxMul = Math.max(minMul, Math.floor(max / multipleOf))
    return intBetween(ctx.rng, minMul, maxMul) * multipleOf
  }
  return isInt ? intBetween(ctx.rng, min, max) : Math.round((min + ctx.rng() * (max - min)) * 100) / 100
}

function singular(key: string): string {
  return key.endsWith('s') && key.length > 1 ? key.slice(0, -1) : key
}

/** Walks a Zod schema and produces a plausible mock value. */
export function generateMockValue(schema: ZodType, key: string, ctx: RngContext): unknown {
  if (ctx.depth > 6) return 'mock'
  const def = zodDef(schema)
  const kind = def.typeName ?? 'unknown'
  ctx.depth++
  try {
    switch (kind) {
      case 'ZodString': return mockString(key, def, ctx)
      case 'ZodNumber': return mockNumber(def, ctx)
      case 'ZodBoolean': return ctx.rng() < 0.75
      case 'ZodDate': return new Date(MOCK_EPOCH - Math.floor(ctx.rng() * YEAR_MS))
      case 'ZodNull': return null
      case 'ZodLiteral': return def.value
      case 'ZodEnum':
      case 'ZodNativeEnum': {
        const values = def.values ?? []
        return values.length > 0 ? pick(values, ctx.rng) : 'mock'
      }
      case 'ZodArray': {
        const element = def.type ?? def.innerType
        const count = intBetween(ctx.rng, 1, 3)
        const result: unknown[] = []
        for (let i = 0; i < count; i++) {
          result.push(element ? generateMockValue(element, singular(key), ctx) : null)
        }
        return result
      }
      case 'ZodObject': {
        const shape = typeof def.shape === 'function' ? def.shape() : def.shape
        const result: Record<string, unknown> = {}
        for (const [childKey, child] of Object.entries(shape ?? {})) {
          result[childKey] = generateMockValue(child, childKey, ctx)
        }
        return result
      }
      case 'ZodUnion':
      case 'ZodDiscriminatedUnion': {
        const options = def.options ?? []
        return options.length > 0 ? generateMockValue(pick(options, ctx.rng), key, ctx) : 'mock'
      }
      case 'ZodIntersection': return def.left ? generateMockValue(def.left, key, ctx) : 'mock'
      case 'ZodRecord': {
        return { [`mock${key}`]: def.valueType ? generateMockValue(def.valueType, key, ctx) : 'mock' }
      }
      case 'ZodTuple': {
        return (def.items ?? []).map((item, index) => generateMockValue(item, `${key}${index}`, ctx))
      }
      case 'ZodOptional':
      case 'ZodCatch':
      case 'ZodBranded': {
        return def.innerType ? generateMockValue(def.innerType, key, ctx) : 'mock'
      }
      case 'ZodNullable': {
        return def.innerType ? generateMockValue(def.innerType, key, ctx) : null
      }
      case 'ZodDefault': {
        try {
          return typeof def.defaultValue === 'function' ? (def.defaultValue as () => unknown)() : def.defaultValue
        } catch {
          return def.innerType ? generateMockValue(def.innerType, key, ctx) : 'mock'
        }
      }
      case 'ZodEffects': {
        const inner = def.schema ?? def.innerType
        return inner ? generateMockValue(inner, key, ctx) : 'mock'
      }
      default: return 'mock'
    }
  } finally {
    ctx.depth--
  }
}

/**
 * Generates a mock response matching the contract's `response` schema.
 * Deterministic for a given contract + seed.
 */
export function generateMockResponse<C extends AnyApiContract>(
  contract: C,
  options?: MockGenerateOptions,
): ContractHandlerResponse<C> {
  const seed = ((options?.seed ?? 42) ^ strHash(contract.name ?? contract.path)) >>> 0
  const ctx: RngContext = { rng: createRng(seed), depth: 0 }
  if (!contract.response) return {} as ContractHandlerResponse<C>
  return generateMockValue(contract.response as ZodType, contract.name ?? 'response', ctx) as ContractHandlerResponse<C>
}

/**
 * Registers a generated mock for a contract — the "mock preset" produced
 * from the contract itself:
 *
 * ```ts
 * import { autoMockContract } from 'nuxt-api-contract/client'
 * autoMockContract(GetUser) // response generated from the schema
 * ```
 */
export function autoMockContract<C extends AnyApiContract>(
  contract: C,
  options?: MockGenerateOptions & Pick<ContractMock<C>, 'delay'>,
): void {
  mockContract(contract, {
    response: () => generateMockResponse(contract, options),
    delay: options?.delay,
  })
}

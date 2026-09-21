/**
 * Deterministic mock-data generation from contract schemas (client-safe: only
 * depends on zod). Used by `autoMockContract`, the `apiContract.mocks: 'auto'`
 * mode and the standalone mock server.
 *
 * Schema introspection goes through `zod-schema.ts`, so Zod 3 and Zod 4 are
 * supported identically.
 */
import type { ZodType } from 'zod'
import { unwrapZodSchema } from './zod-schema'
import type { ZodCheck, ZodCheckKind } from './zod-schema'
import type { AnyApiContract, ContractHandlerResponse } from './types'
import { mockContract, type ContractMock } from './contract'

export interface MockGenerateOptions {
  /** Seed for deterministic generation (default: 42). */
  seed?: number
}

/** Randomness context used while walking a schema (exported for tooling). */
export interface RngContext {
  rng: () => number
  depth: number
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

const HEX = '0123456789abcdef'
const VARIANT = '89ab'

/**
 * Generates an RFC 4122 version-4 UUID. Zod 4 validates both the version and
 * the variant nibbles, so the shape must be exact.
 */
function mockUuid(rng: () => number): string {
  const hex = (length: number): string => {
    let out = ''
    for (let i = 0; i < length; i++) out += HEX.charAt(Math.floor(rng() * 16))
    return out
  }
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${VARIANT.charAt(Math.floor(rng() * 4))}${hex(3)}-${hex(12)}`
}


/* ------------------------------------------------------------------ *
 * Check helpers
 * ------------------------------------------------------------------ */

function numericCheck(checks: ZodCheck[], kind: ZodCheckKind): number | undefined {
  const check = checks.find(candidate => candidate.kind === kind)
  return typeof check?.value === 'number' ? check.value : undefined
}

function hasCheck(checks: ZodCheck[], kind: ZodCheckKind): boolean {
  return checks.some(check => check.kind === kind)
}

function hasFormat(checks: ZodCheck[], format: string): boolean {
  return checks.some(check => check.kind === 'format' && check.format === format)
}

/** Generates a plausible string for a field, guided by its name and checks. */
function mockString(key: string, checks: ZodCheck[], ctx: RngContext): string {
  const lower = key.toLowerCase()

  let value: string
  if (hasFormat(checks, 'email') || lower.includes('email')) {
    const name = pick(FIRST_NAMES, ctx.rng).toLowerCase()
    value = `${name}.${pick(LAST_NAMES, ctx.rng).toLowerCase()}@example.com`
  } else if (hasFormat(checks, 'uuid') || lower.endsWith('uuid')) {
    value = mockUuid(ctx.rng)
  } else if (hasFormat(checks, 'datetime') || hasFormat(checks, 'date') || lower === 'createdat' || lower === 'updatedat' || lower.endsWith('date') || lower.endsWith('_at')) {
    value = new Date(MOCK_EPOCH - Math.floor(ctx.rng() * YEAR_MS)).toISOString()
  } else if (hasFormat(checks, 'url') || lower.endsWith('url') || lower.endsWith('link')) {
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

  const minLength = numericCheck(checks, 'min') ?? numericCheck(checks, 'length')
  if (minLength !== undefined) {
    while (value.length < minLength) value += '-filler'
  }
  const maxLength = numericCheck(checks, 'max') ?? numericCheck(checks, 'length')
  if (maxLength !== undefined && value.length > maxLength) {
    value = value.slice(0, maxLength)
  }
  return value
}

function mockNumber(checks: ZodCheck[], ctx: RngContext): number {
  const isInt = hasCheck(checks, 'int')
  const min = numericCheck(checks, 'min') ?? 1
  const max = numericCheck(checks, 'max') ?? 100
  const multipleOf = numericCheck(checks, 'multipleOf')
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
  ctx.depth++
  try {
    const unwrapped = unwrapZodSchema(schema)

    // Defaults win — the schema guarantees that value.
    if (unwrapped.hasDefault && unwrapped.defaultValue !== undefined) {
      return unwrapped.defaultValue
    }

    const { descriptor, checks } = unwrapped
    switch (descriptor.kind) {
      case 'string':
        return mockString(key, checks, ctx)
      case 'number':
        return mockNumber(checks, ctx)
      case 'bigint':
        return BigInt(intBetween(ctx.rng, 1, 1000))
      case 'boolean':
        return ctx.rng() < 0.75
      case 'date':
        return new Date(MOCK_EPOCH - Math.floor(ctx.rng() * YEAR_MS))
      case 'nan':
        return Number.NaN
      case 'null':
        return null
      case 'undefined':
      case 'void':
        return undefined
      case 'symbol':
        return 'mock'
      case 'literal':
      case 'enum': {
        const values = descriptor.values ?? []
        return values.length > 0 ? pick(values, ctx.rng) : 'mock'
      }
      case 'array':
      case 'set': {
        const element = descriptor.element
        const count = intBetween(ctx.rng, 1, 3)
        const result: unknown[] = []
        for (let i = 0; i < count; i++) {
          result.push(element ? generateMockValue(element, singular(key), ctx) : null)
        }
        return result
      }
      case 'tuple': {
        return (descriptor.items ?? []).map((item, index) => generateMockValue(item, `${key}${index}`, ctx))
      }
      case 'object': {
        const shape = descriptor.shape ?? {}
        const result: Record<string, unknown> = {}
        for (const [childKey, child] of Object.entries(shape)) {
          result[childKey] = generateMockValue(child, childKey, ctx)
        }
        return result
      }
      case 'union': {
        const options = descriptor.options ?? []
        return options.length > 0 ? generateMockValue(pick(options, ctx.rng), key, ctx) : 'mock'
      }
      case 'intersection': {
        // Both sides must hold: merge object schemas, otherwise use the left one.
        if (descriptor.left && descriptor.right) {
          const left = generateMockValue(descriptor.left, key, ctx)
          const right = generateMockValue(descriptor.right, key, ctx)
          if (isPlainRecord(left) && isPlainRecord(right)) return { ...left, ...right }
          return left
        }
        return 'mock'
      }
      case 'record':
      case 'map': {
        return { [`mock${key}`]: descriptor.valueType ? generateMockValue(descriptor.valueType, key, ctx) : 'mock' }
      }
      case 'refinement':
      case 'custom':
      case 'unsupported':
      case 'any':
      case 'unknown':
      case 'never':
      case 'promise':
      case 'function':
      case 'transform':
        return 'mock'
      case 'file':
        // Files are not representable in JSON payloads.
        return null
      case 'readonly':
      case 'optional':
      case 'nullable':
      case 'default':
      case 'catch':
      case 'lazy': {
        const inner = descriptor.inner ?? descriptor.getter?.()
        return inner ? generateMockValue(inner, key, ctx) : 'mock'
      }
      case 'pipe': {
        const inner = descriptor.input ?? descriptor.output
        return inner ? generateMockValue(inner, key, ctx) : 'mock'
      }
      default:
        return 'mock'
    }
  } finally {
    ctx.depth--
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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



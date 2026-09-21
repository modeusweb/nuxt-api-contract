/**
 * Zod schema introspection layer (Zod 3 **and** Zod 4).
 *
 * Every tool that needs to *read* schemas — mock generation, OpenAPI
 * generation, TypeScript client emission — goes through this module. It turns
 * the two incompatible internal representations into one normalized
 * descriptor, so consumers never touch `_def` / `_zod.def` directly.
 *
 * Zod 4 (1.0.0 support):
 * - `schema._def.type` holds the kind (`string`, `object`, `pipe`, …) and
 *   `typeName` no longer exists;
 * - checks moved to `def.checks[]`, where each entry is a `$ZodCheck` whose
 *   `_zod.def` describes it (`{ check: 'min_length', minimum: 3 }`);
 * - "format schemas" created by top-level helpers (`z.email()`, `z.url()`,
 *   `z.iso.datetime()`, …) describe the check on the schema def itself;
 * - objects expose `def.shape` as a plain object and use `def.catchall` to
 *   express strict / loose objects;
 * - `.refine()` / `.superRefine()` attach a `custom` check to the *same*
 *   schema (Zod 3 wrapped it in `ZodEffects`);
 * - `.transform()` / `z.preprocess()` produce a `pipe` with `in` / `out`.
 *
 * This module is dependency-free (zod type imports only), so it stays safe
 * for the client bundle and for build-time tooling.
 */
import type { ZodType } from 'zod'

/** Normalized schema kinds shared by Zod 3 and Zod 4. */
export type ZodSchemaKind =
  | 'string'
  | 'number'
  | 'bigint'
  | 'boolean'
  | 'date'
  | 'symbol'
  | 'nan'
  | 'null'
  | 'undefined'
  | 'void'
  | 'any'
  | 'unknown'
  | 'never'
  | 'custom'
  | 'file'
  | 'literal'
  | 'enum'
  | 'array'
  | 'object'
  | 'union'
  | 'intersection'
  | 'record'
  | 'map'
  | 'set'
  | 'tuple'
  | 'optional'
  | 'nullable'
  | 'default'
  | 'catch'
  | 'readonly'
  | 'lazy'
  | 'promise'
  | 'function'
  | 'pipe'
  | 'transform'
  | 'refinement'
  | 'unsupported'

/** Normalized check kinds (boundaries, formats, refinements). */
export type ZodCheckKind =
  | 'min'
  | 'max'
  | 'length'
  | 'int'
  | 'multipleOf'
  | 'format'
  | 'regex'
  | 'refinement'
  | 'overwrite'

/** A normalized schema check. */
export interface ZodCheck {
  kind: ZodCheckKind
  /** Numeric / temporal / bigint bound (min, max, length, multipleOf). */
  value?: number | string | bigint | Date
  /** Whether a `min` / `max` bound includes the boundary (defaults to true). */
  inclusive?: boolean
  /**
   * Format name for `kind: 'format'`, normalized to the Zod 3 wording where
   * the majors differ (`datetime`, `email`, `uuid`, `url`, …).
   */
  format?: string
  /** RegExp source for regex checks. */
  pattern?: string
}

/** Normalized view of a Zod schema. */
export interface ZodSchemaDescriptor {
  /** Normalized kind. */
  kind: ZodSchemaKind
  /** Raw Zod 3 `typeName` / Zod 4 `type`, for diagnostics. */
  rawKind?: string
  /** `.describe()` / `.meta({ description })` value, when present. */
  description?: string
  /** Schema was created through `z.coerce.*`. */
  coerce: boolean
  /** String / number / collection checks, normalized. */
  checks: ZodCheck[]
  /** `kind: 'object'` — object shape. */
  shape?: Record<string, ZodType>
  /** `kind: 'object'` — unknown-key policy. */
  unknownKeys?: 'strip' | 'strict' | 'passthrough'
  /** Element schema for array / set. */
  element?: ZodType
  /** Value schema for record / map. */
  valueType?: ZodType
  /** Key schema for record / map. */
  keyType?: ZodType
  /** `kind: 'tuple'` items (+ optional rest schema). */
  items?: ZodType[]
  rest?: ZodType
  /** `kind: 'union'` options (+ discriminator key). */
  options?: ZodType[]
  discriminatedBy?: string
  /** `kind: 'intersection'`. */
  left?: ZodType
  right?: ZodType
  /** Wrapper inner schema (optional / nullable / default / catch / readonly / promise). */
  inner?: ZodType
  /** `kind: 'pipe'` — input and output schemas. */
  input?: ZodType
  output?: ZodType
  /** Which transformation a pipe / effects node performs. */
  effect?: 'transform' | 'refinement' | 'preprocess' | 'pipe' | 'unknown'
  /** `kind: 'literal' | 'enum'` — allowed values. */
  values?: unknown[]
  /** `kind: 'default'` — the default value (lazy defaults are invoked). */
  defaultValue?: unknown
  /** `kind: 'catch'` — the fallback value. */
  catchValue?: unknown
  /** `kind: 'lazy'` — the wrapped getter. */
  getter?: () => ZodType
}


/* ------------------------------------------------------------------ *
 * Raw definition access (typed boundary)
 * ------------------------------------------------------------------ */

interface RawCheck {
  /** Zod 3 check kind. */
  kind?: string
  value?: unknown
  regex?: RegExp
  inclusive?: boolean
  /** Zod 4 check definition. */
  _zod?: { def?: Record<string, unknown> }
}

interface RawDef extends Record<string, unknown> {
  typeName?: string
  type?: string | ZodType
  description?: string
  coerce?: boolean
  checks?: (RawCheck | null)[] | null
  shape?: Record<string, ZodType> | (() => Record<string, ZodType>)
  unknownKeys?: string
  catchall?: ZodType
  element?: ZodType
  valueType?: ZodType
  keyType?: ZodType
  items?: ZodType[]
  rest?: ZodType
  options?: ZodType[]
  discriminator?: string
  left?: ZodType
  right?: ZodType
  innerType?: ZodType
  getter?: () => ZodType
  in?: ZodType
  out?: ZodType
  effect?: { type?: string }
  schema?: ZodType
  values?: unknown
  entries?: Record<string, unknown>
  value?: unknown
  defaultValue?: unknown
  catchValue?: unknown
  minLength?: { value?: number } | null
  maxLength?: { value?: number } | null
  exactLength?: { value?: number } | null
  minSize?: { value?: number } | null
  maxSize?: { value?: number } | null
  minDate?: Date | null
  maxDate?: Date | null
  /** Zod 4: present when the schema *is* a check (top-level `z.email()`, …). */
  check?: string
  format?: string
  pattern?: RegExp
  inclusive?: boolean
}

function rawDef(schema: ZodType): RawDef {
  const holder = schema as unknown as { _def?: RawDef, def?: RawDef }
  return holder._def ?? holder.def ?? {}
}

/** Reads the description of a schema across Zod majors. */
function readDescription(schema: ZodType, def: RawDef): string | undefined {
  const own = (schema as unknown as { description?: unknown }).description
  if (typeof own === 'string' && own.length > 0) return own
  const nested = (schema as unknown as { _zod?: { def?: { description?: unknown } } })._zod?.def?.description
  if (typeof nested === 'string' && nested.length > 0) return nested
  return typeof def.description === 'string' ? def.description : undefined
}

function isV4(def: RawDef): boolean {
  return def.typeName === undefined && typeof def.type === 'string'
}

function innerKind(schema: ZodType | undefined): string | undefined {
  if (!schema) return undefined
  const def = rawDef(schema)
  return typeof def.type === 'string' ? def.type : def.typeName
}


/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

/** Zod 4 `$ZodCheck` definition -> normalized checks. */
function normalizeV4Check(check: Record<string, unknown>): ZodCheck[] {
  const name = typeof check.check === 'string' ? check.check : undefined
  if (!name) return []
  switch (name) {
    case 'min_length':
    case 'min_size':
      return [{ kind: 'min', value: asNumber(check.minimum) }]
    case 'max_length':
    case 'max_size':
      return [{ kind: 'max', value: asNumber(check.maximum) }]
    case 'length_equals':
    case 'size_equals':
      return [{ kind: 'length', value: asNumber(check.length) }]
    case 'greater_than':
      return [{ kind: 'min', value: asBoundValue(check.value), inclusive: check.inclusive !== false }]
    case 'less_than':
      return [{ kind: 'max', value: asBoundValue(check.value), inclusive: check.inclusive !== false }]
    case 'multiple_of':
      return [{ kind: 'multipleOf', value: asNumber(check.value) }]
    case 'number_format':
      return String(check.format ?? '').includes('int') ? [{ kind: 'int' }] : []
    case 'string_format': {
      const format = String(check.format ?? '')
      const pattern = check.pattern instanceof RegExp ? check.pattern.source : undefined
      if (format === 'regex') return [{ kind: 'regex', pattern }]
      return [{ kind: 'format', format: normalizeFormatName(format), pattern }]
    }
    case 'custom':
      return [{ kind: 'refinement' }]
    case 'overwrite':
      return [{ kind: 'overwrite' }]
    default:
      return []
  }
}

/** Zod 3 check -> normalized checks. */
function normalizeV3Check(check: RawCheck): ZodCheck[] {
  const kind = check.kind
  if (!kind) return []
  switch (kind) {
    case 'min':
    case 'max':
      return [{ kind, value: asBoundValue(check.value), inclusive: check.inclusive !== false }]
    case 'length':
    case 'size':
      return [{ kind: 'length', value: asNumber(check.value) }]
    case 'int':
      return [{ kind: 'int' }]
    case 'multipleOf':
      return [{ kind: 'multipleOf', value: asNumber(check.value) }]
    case 'regex':
      return [{ kind: 'regex', pattern: check.regex?.source }]
    case 'finite':
    case 'safe':
    case 'trim':
    case 'toLowerCase':
    case 'toUpperCase':
      return [{ kind: 'overwrite' }]
    default:
      return [{ kind: 'format', format: kind }]
  }
}

/** Collects the normalized checks of a schema for both majors. */
function readChecks(def: RawDef, mode: 'v3' | 'v4'): ZodCheck[] {
  const result: ZodCheck[] = []
  // Zod 4 format schemas (z.email(), z.url(), z.iso.datetime()) describe the
  // check on the schema def itself instead of inside `checks`.
  if (mode === 'v4' && typeof def.check === 'string') {
    result.push(...normalizeV4Check(def as unknown as Record<string, unknown>))
  }
  for (const check of def.checks ?? []) {
    if (!check) continue
    if (mode === 'v3') {
      result.push(...normalizeV3Check(check))
    } else {
      const checkDef = check._zod?.def
      if (checkDef) result.push(...normalizeV4Check(checkDef))
    }
  }
  return result
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  return undefined
}

function asBoundValue(value: unknown): number | string | bigint | Date | undefined {
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint' || value instanceof Date) return value
  return undefined
}

/** Normalizes Zod 4 format names to the Zod 3 wording consumers expect. */
function normalizeFormatName(format: string): string {
  switch (format) {
    case 'http_url':
    case 'url':
      return 'url'
    case 'starts_with':
    case 'startswith':
      return 'startsWith'
    case 'ends_with':
    case 'endswith':
      return 'endsWith'
    default:
      return format
  }
}


/* ------------------------------------------------------------------ *
 * Kind mapping
 * ------------------------------------------------------------------ */

const V3_KIND_MAP: Record<string, ZodSchemaKind> = {
  ZodString: 'string',
  ZodNumber: 'number',
  ZodBigInt: 'bigint',
  ZodBoolean: 'boolean',
  ZodDate: 'date',
  ZodSymbol: 'symbol',
  ZodNaN: 'nan',
  ZodNull: 'null',
  ZodUndefined: 'undefined',
  ZodVoid: 'void',
  ZodAny: 'any',
  ZodUnknown: 'unknown',
  ZodNever: 'never',
  ZodCustom: 'custom',
  ZodInstanceof: 'custom',
  ZodLiteral: 'literal',
  ZodEnum: 'enum',
  ZodNativeEnum: 'enum',
  ZodArray: 'array',
  ZodObject: 'object',
  ZodUnion: 'union',
  ZodDiscriminatedUnion: 'union',
  ZodIntersection: 'intersection',
  ZodRecord: 'record',
  ZodMap: 'map',
  ZodSet: 'set',
  ZodTuple: 'tuple',
  ZodOptional: 'optional',
  ZodNullable: 'nullable',
  ZodDefault: 'default',
  ZodCatch: 'catch',
  ZodBranded: 'refinement',
  ZodReadonly: 'readonly',
  ZodLazy: 'lazy',
  ZodPromise: 'promise',
  ZodFunction: 'function',
  ZodEffects: 'pipe',
  ZodPipeline: 'pipe',
}

const V4_KIND_MAP: Record<string, ZodSchemaKind> = {
  string: 'string',
  number: 'number',
  bigint: 'bigint',
  boolean: 'boolean',
  date: 'date',
  symbol: 'symbol',
  nan: 'nan',
  null: 'null',
  undefined: 'undefined',
  void: 'void',
  any: 'any',
  unknown: 'unknown',
  never: 'never',
  custom: 'custom',
  file: 'file',
  literal: 'literal',
  enum: 'enum',
  array: 'array',
  object: 'object',
  union: 'union',
  intersection: 'intersection',
  record: 'record',
  map: 'map',
  set: 'set',
  tuple: 'tuple',
  optional: 'optional',
  nonoptional: 'optional',
  nullable: 'nullable',
  default: 'default',
  catch: 'catch',
  readonly: 'readonly',
  lazy: 'lazy',
  promise: 'promise',
  function: 'function',
  transform: 'transform',
  pipe: 'pipe',
}

/* ------------------------------------------------------------------ *
 * Descriptors
 * ------------------------------------------------------------------ */

/** Normalizes a Zod schema (Zod 3 or Zod 4) into a descriptor. */
export function describeZodSchema(schema: ZodType): ZodSchemaDescriptor {
  const def = rawDef(schema)
  return isV4(def) ? describeV4(def, schema) : describeV3(def, schema)
}

function baseDescriptor(schema: ZodType, def: RawDef, kind: ZodSchemaKind, mode: 'v3' | 'v4'): ZodSchemaDescriptor {
  return {
    kind,
    rawKind: mode === 'v3' ? def.typeName : (typeof def.type === 'string' ? def.type : undefined),
    description: readDescription(schema, def),
    coerce: def.coerce === true,
    checks: readChecks(def, mode),
  }
}


function describeV3(def: RawDef, schema: ZodType): ZodSchemaDescriptor {
  const rawKind = def.typeName ?? 'ZodUnknown'
  const descriptor = baseDescriptor(schema, def, V3_KIND_MAP[rawKind] ?? 'unsupported', 'v3')

  switch (rawKind) {
    case 'ZodObject':
      descriptor.shape = typeof def.shape === 'function' ? def.shape() : (def.shape ?? {})
      descriptor.unknownKeys = def.unknownKeys === 'strict'
        ? 'strict'
        : def.unknownKeys === 'passthrough' ? 'passthrough' : 'strip'
      break
    case 'ZodArray':
      descriptor.element = def.type as ZodType
      pushV3Sizes(descriptor, def)
      break
    case 'ZodSet':
    case 'ZodMap':
      descriptor.element = def.valueType
      descriptor.keyType = def.keyType
      descriptor.valueType = def.valueType
      pushV3Sizes(descriptor, def)
      break
    case 'ZodDate':
      if (def.minDate instanceof Date) descriptor.checks.push({ kind: 'min', value: def.minDate })
      if (def.maxDate instanceof Date) descriptor.checks.push({ kind: 'max', value: def.maxDate })
      break
    case 'ZodRecord':
      descriptor.keyType = def.keyType
      descriptor.valueType = def.valueType
      break
    case 'ZodTuple':
      descriptor.items = def.items ?? []
      descriptor.rest = def.rest
      break
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      descriptor.options = def.options ?? []
      descriptor.discriminatedBy = def.discriminator
      break
    case 'ZodIntersection':
      descriptor.left = def.left
      descriptor.right = def.right
      break
    case 'ZodLiteral':
      descriptor.values = [def.value]
      break
    case 'ZodEnum':
      descriptor.values = Array.isArray(def.values) ? [...def.values] : Object.values(def.values ?? {})
      break
    case 'ZodNativeEnum':
      descriptor.values = Object.values((def.values ?? {}) as Record<string, unknown>)
      break
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
      descriptor.inner = def.innerType
      break
    case 'ZodBranded':
    case 'ZodPromise':
      descriptor.inner = def.type as ZodType
      break
    case 'ZodLazy':
      descriptor.getter = def.getter
      break
    case 'ZodEffects': {
      const effect = def.effect?.type
      descriptor.effect = effect === 'transform' || effect === 'preprocess' || effect === 'refinement' ? effect : 'unknown'
      descriptor.input = def.schema
      descriptor.output = def.schema
      if (effect === 'refinement' && !descriptor.checks.some(check => check.kind === 'refinement')) {
        descriptor.checks.push({ kind: 'refinement' })
      }
      break
    }
    case 'ZodPipeline':
      descriptor.effect = 'pipe'
      descriptor.input = def.in
      descriptor.output = def.out
      break
    default:
      break
  }

  if (rawKind === 'ZodDefault') descriptor.defaultValue = readDefaultValue(def)
  if (rawKind === 'ZodCatch') descriptor.catchValue = readCatchValue(def)

  return descriptor
}

function pushV3Sizes(descriptor: ZodSchemaDescriptor, def: RawDef): void {
  const min = def.minLength?.value ?? def.minSize?.value
  const max = def.maxLength?.value ?? def.maxSize?.value
  const exact = def.exactLength?.value
  if (typeof min === 'number') descriptor.checks.push({ kind: 'min', value: min })
  if (typeof max === 'number') descriptor.checks.push({ kind: 'max', value: max })
  if (typeof exact === 'number') descriptor.checks.push({ kind: 'length', value: exact })
}


function describeV4(def: RawDef, schema: ZodType): ZodSchemaDescriptor {
  const rawKind = typeof def.type === 'string' ? def.type : 'unknown'
  const descriptor = baseDescriptor(schema, def, V4_KIND_MAP[rawKind] ?? 'unsupported', 'v4')

  switch (rawKind) {
    case 'object':
      descriptor.shape = typeof def.shape === 'function' ? def.shape() : (def.shape ?? {})
      descriptor.unknownKeys = innerKind(def.catchall) === 'never'
        ? 'strict'
        : innerKind(def.catchall) === 'unknown' ? 'passthrough' : 'strip'
      break
    case 'array':
    case 'set':
      descriptor.element = def.element ?? def.valueType
      break
    case 'map':
    case 'record':
      descriptor.keyType = def.keyType
      descriptor.valueType = def.valueType
      break
    case 'tuple':
      descriptor.items = def.items ?? []
      descriptor.rest = def.rest
      break
    case 'union':
      descriptor.options = def.options ?? []
      descriptor.discriminatedBy = def.discriminator
      break
    case 'intersection':
      descriptor.left = def.left
      descriptor.right = def.right
      break
    case 'literal':
      descriptor.values = Array.isArray(def.values) ? [...def.values] : def.value === undefined ? [] : [def.value]
      break
    case 'enum':
      descriptor.values = def.entries
        ? Object.values(def.entries)
        : Array.isArray(def.values) ? [...def.values] : []
      break
    case 'optional':
    case 'nonoptional':
    case 'nullable':
    case 'catch':
    case 'readonly':
    case 'promise':
      descriptor.inner = def.innerType
      break
    case 'default':
      descriptor.inner = def.innerType
      descriptor.defaultValue = readDefaultValue(def)
      break
    case 'lazy':
      descriptor.getter = def.getter
      break
    case 'pipe': {
      descriptor.input = def.in
      descriptor.output = def.out
      const inKind = innerKind(def.in)
      const outKind = innerKind(def.out)
      descriptor.effect = inKind === 'transform' ? 'preprocess' : outKind === 'transform' ? 'transform' : 'pipe'
      break
    }
    default:
      break
  }

  if (rawKind === 'catch') descriptor.catchValue = readCatchValue(def)
  return descriptor
}

function readDefaultValue(def: RawDef): unknown {
  const value = def.defaultValue
  if (typeof value !== 'function') return value
  try {
    return (value as () => unknown)()
  } catch {
    return undefined
  }
}

function readCatchValue(def: RawDef): unknown {
  const value = def.catchValue
  if (typeof value !== 'function') return value
  try {
    return (value as (ctx: unknown) => unknown)({})
  } catch {
    return undefined
  }
}


/* ------------------------------------------------------------------ *
 * Convenience helpers
 * ------------------------------------------------------------------ */

/** Normalized kind of a schema. */
export function zodSchemaKind(schema: ZodType): ZodSchemaKind {
  return describeZodSchema(schema).kind
}

/** True when the schema is (or wraps) an object schema. */
export function isObjectSchema(schema: ZodType): boolean {
  return unwrapZodSchema(schema).descriptor.kind === 'object'
}

export interface UnwrappedSchema {
  /** The innermost schema of interest (scalar / object / union / …). */
  schema: ZodType
  /** Descriptor of `schema`. */
  descriptor: ZodSchemaDescriptor
  /** The value may be `undefined` (optional / default). */
  optional: boolean
  /** The value may be `null`. */
  nullable: boolean
  /** The schema provides a default (the output is always present). */
  hasDefault: boolean
  /** The default value found while unwrapping (when `hasDefault`). */
  defaultValue?: unknown
  /** Checks collected from the schema and every unwrapped wrapper. */
  checks: ZodCheck[]
}

interface WrapperStep {
  schema: ZodType
  optional?: boolean
  nullable?: boolean
  hasDefault?: boolean
  defaultValue?: unknown
}

/**
 * Returns the next schema inside a wrapper, or `undefined` for terminal
 * schemas. Pipes (`transform` / `preprocess`) are intentionally *not*
 * unwrapped: their output type is not representable, so consumers handle them
 * explicitly and emit a warning.
 */
function wrapperStep(descriptor: ZodSchemaDescriptor): WrapperStep | undefined {
  switch (descriptor.kind) {
    case 'optional':
      return descriptor.inner ? { schema: descriptor.inner, optional: true } : undefined
    case 'nullable':
      return descriptor.inner ? { schema: descriptor.inner, nullable: true } : undefined
    case 'default':
      return descriptor.inner ? { schema: descriptor.inner, hasDefault: true, defaultValue: descriptor.defaultValue } : undefined
    case 'catch':
    case 'readonly':
      return descriptor.inner ? { schema: descriptor.inner } : undefined
    case 'refinement':
      // Zod 3 `.brand()` wraps the schema; Zod 4 brands in place.
      return descriptor.rawKind === 'ZodBranded' && descriptor.inner ? { schema: descriptor.inner } : undefined
    case 'lazy': {
      try {
        const inner = descriptor.getter?.()
        return inner ? { schema: inner } : undefined
      } catch {
        return undefined
      }
    }
    default:
      return undefined
  }
}

/**
 * Unwraps optional / nullable / default / catch / readonly / branded / lazy
 * wrappers and collects the metadata consumers need (optionality,
 * nullability, defaults, checks).
 */
export function unwrapZodSchema(schema: ZodType): UnwrappedSchema {
  let current: ZodType = schema
  let optional = false
  let nullable = false
  let hasDefault = false
  let defaultValue: unknown
  const checks: ZodCheck[] = []

  for (let step = 0; step < 12; step++) {
    const descriptor = describeZodSchema(current)
    checks.push(...descriptor.checks)
    const next = wrapperStep(descriptor)
    if (!next) break
    if (next.optional) optional = true
    if (next.nullable) nullable = true
    if (next.hasDefault) {
      hasDefault = true
      defaultValue = next.defaultValue
    }
    current = next.schema
  }

  return {
    schema: current,
    descriptor: describeZodSchema(current),
    optional,
    nullable,
    hasDefault,
    defaultValue,
    checks,
  }
}







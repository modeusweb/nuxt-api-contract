/**
 * Zod -> TypeScript type emission for the generated client (build-time only).
 * Follows the same "best effort + warning" policy as the OpenAPI layer:
 * unsupported Zod features degrade to the closest representable type and a
 * warning is collected — emission never fails.
 */
import type { ZodType } from 'zod'

/** Runtime shape of a Zod schema definition (zod 3 internals). */
interface ZodDefLike {
  typeName?: string
  shape?: Record<string, ZodType> | (() => Record<string, ZodType>)
  innerType?: ZodType
  options?: ZodType[]
  value?: unknown
  values?: unknown
  items?: ZodType[]
  valueType?: ZodType
  type?: ZodType
  effect?: { type?: string }
  left?: ZodType
  right?: ZodType
  schema?: ZodType
}

/** Accesses zod internals through a typed boundary. */
export function zodDef(schema: ZodType): ZodDefLike {
  return (schema as unknown as { _def: ZodDefLike })._def
}

/** Returns the shape of a ZodObject definition. */
export function objectShape(def: ZodDefLike): Record<string, ZodType> {
  const shape = def.shape
  if (typeof shape === 'function') return shape()
  return shape ?? {}
}

/**
 * Emission mode:
 * - `input`  — types for what the client sends (`.default()` makes a prop optional)
 * - `output` — types for what the client receives (`.default()` values are always present)
 */
export type EmissionMode = 'input' | 'output'

interface PropMeta {
  inner: ZodType
  optional: boolean
  nullish: boolean
}

/** Unwraps optionality/nullability wrappers of a property schema. */
function propMeta(schema: ZodType, mode: EmissionMode): PropMeta {
  let current = schema
  let optional = false
  let nullish = false
  for (;;) {
    const def = zodDef(current)
    if (def.typeName === 'ZodOptional') {
      optional = true
      current = def.innerType!
      continue
    }
    if (def.typeName === 'ZodNullable') {
      nullish = true
      current = def.innerType!
      continue
    }
    if (def.typeName === 'ZodDefault') {
      if (mode === 'input') optional = true
      current = def.innerType!
      continue
    }
    break
  }
  return { inner: current, optional, nullish }
}

/** Builds an object-member line for a property (shared by inline/named emission). */
export function emitMember(key: string, value: ZodType, mode: EmissionMode, warnings: string[], path: string): string {
  const meta = propMeta(value, mode)
  let type = emitTsType(meta.inner, mode, warnings, `${path}.${key}`)
  if (meta.nullish) type = `${type} | null${meta.optional ? ' | undefined' : ''}`
  return `  ${JSON.stringify(key)}${meta.optional ? '?' : ''}: ${type}`
}

/** Emits a TypeScript type string for the schema. Warnings are accumulated. */
export function emitTsType(schema: ZodType, mode: EmissionMode, warnings: string[], path = 'schema'): string {
  const def = zodDef(schema)
  switch (def.typeName) {
    case 'ZodString':
      return 'string'
    case 'ZodNumber':
      return 'number'
    case 'ZodBigInt': {
      warnings.push(`${path}: bigint is serialized as a JSON string over HTTP`)
      return 'string'
    }
    case 'ZodBoolean':
      return 'boolean'
    case 'ZodDate': {
      warnings.push(`${path}: Date is serialized as an ISO string over HTTP`)
      return 'string'
    }
    case 'ZodUndefined':
      return 'undefined'
    case 'ZodNull':
      return 'null'
    case 'ZodVoid':
      return 'undefined'
    case 'ZodAny':
    case 'ZodUnknown':
      return 'unknown'
    case 'ZodNever':
      return 'never'
    case 'ZodLiteral': {
      const value = def.value
      if (value === null) return 'null'
      if (typeof value === 'string') return JSON.stringify(value)
      if (typeof value === 'number' || typeof value === 'boolean') return String(value)
      warnings.push(`${path}: unsupported literal value emitted as unknown`)
      return 'unknown'
    }
    case 'ZodEnum': {
      const values = def.values
      if (Array.isArray(values)) return values.map(value => JSON.stringify(value)).join(' | ')
      warnings.push(`${path}: unsupported enum values emitted as unknown`)
      return 'unknown'
    }
    case 'ZodNativeEnum': {
      const values = def.values
      if (values !== null && typeof values === 'object') {
        return Object.values(values as Record<string, string | number>)
          .map(value => (typeof value === 'string' ? JSON.stringify(value) : String(value)))
          .join(' | ')
      }
      warnings.push(`${path}: unsupported native enum emitted as unknown`)
      return 'unknown'
    }
    case 'ZodArray': {
      const inner = emitTsType(def.innerType ?? def.type!, mode, warnings, `${path}[]`)
      return `Array<${inner}>`
    }
    case 'ZodObject': {
      const shape = objectShape(def)
      const members = Object.entries(shape).map(([key, value]) => emitMember(key, value, mode, warnings, path))
      if (members.length === 0) return 'Record<string, never>'
      return `{\n${members.join('\n')}\n}`
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = def.options ?? []
      if (options.length === 0) {
        warnings.push(`${path}: union without options emitted as unknown`)
        return 'unknown'
      }
      return options.map((option, index) => emitTsType(option, mode, warnings, `${path}[${index}]`)).join(' | ')
    }
    case 'ZodIntersection':
      return `${emitTsType(def.left!, mode, warnings, `${path}.left`)} & ${emitTsType(def.right!, mode, warnings, `${path}.right`)}`
    case 'ZodTuple': {
      const items = def.items ?? []
      return `[${items.map((item, index) => emitTsType(item, mode, warnings, `${path}[${index}]`)).join(', ')}]`
    }
    case 'ZodRecord':
      return `Record<string, ${emitTsType(def.valueType!, mode, warnings, `${path}.value`)}>`
    case 'ZodEffects': {
      const effectType = def.effect?.type
      const inner = def.innerType ?? def.schema
      if (inner) {
        if (effectType === 'transform' || effectType === 'preprocess') {
          warnings.push(`${path}: ${effectType} is not representable — emitting the underlying schema type`)
        }
        return emitTsType(inner, mode, warnings, path)
      }
      warnings.push(`${path}: effect without an inner type emitted as unknown`)
      return 'unknown'
    }
    case 'ZodOptional': {
      const inner = emitTsType(def.innerType!, mode, warnings, path)
      return `${inner} | undefined`
    }
    case 'ZodNullable':
      return `${emitTsType(def.innerType!, mode, warnings, path)} | null`
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodBranded':
    case 'ZodReadonly':
      return emitTsType(def.innerType!, mode, warnings, path)
    default: {
      warnings.push(`${path}: unsupported schema (${def.typeName ?? 'unknown'}) emitted as unknown`)
      return 'unknown'
    }
  }
}

/**
 * Emits a named type declaration for a schema:
 * - ZodObject -> `export interface Name { ... }`
 * - everything else -> `export type Name = <inline>`
 *
 * Returns `null` when the schema is `undefined`.
 */
export function emitNamedType(
  name: string,
  schema: ZodType | undefined,
  mode: EmissionMode,
  warnings: string[],
  path = name,
): string | null {
  if (!schema) return null
  const def = zodDef(schema)
  if (def.typeName === 'ZodObject') {
    const shape = objectShape(def)
    const members = Object.entries(shape).map(([key, value]) => emitMember(key, value, mode, warnings, path))
    const body = members.length === 0 ? '  [key: string]: never' : members.join('\n')
    return `export interface ${name} {\n${body}\n}`
  }
  return `export type ${name} = ${emitTsType(schema, mode, warnings, path)}`
}

/** Extracts path parameter names from a contract path. */
export function pathParamNames(path: string): string[] {
  const names: string[] = []
  for (const match of path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)) names.push(match[1]!)
  return names
}

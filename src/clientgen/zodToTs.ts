/**
 * Zod -> TypeScript type emission for the generated client (build-time only).
 *
 * Follows the same "best effort + warning" policy as the OpenAPI layer:
 * unsupported Zod features degrade to the closest representable type and a
 * warning is collected — emission never fails.
 *
 * Schema reading goes through `zod-schema.ts`, so Zod 3 and Zod 4 are handled
 * identically.
 */
import type { ZodType } from 'zod'
import { unwrapZodSchema } from '../runtime/shared/zod-schema'

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

/** Reads optionality/nullability of a property schema. */
function propMeta(schema: ZodType, mode: EmissionMode): PropMeta {
  const unwrapped = unwrapZodSchema(schema)
  return {
    inner: unwrapped.schema,
    optional: unwrapped.optional || (mode === 'input' && unwrapped.hasDefault),
    nullish: unwrapped.nullable,
  }
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
  const { descriptor, checks } = unwrapZodSchema(schema)

  switch (descriptor.kind) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'bigint': {
      warnings.push(`${path}: bigint is serialized as a JSON string over HTTP`)
      return 'string'
    }
    case 'boolean':
      return 'boolean'
    case 'date': {
      warnings.push(`${path}: Date is serialized as an ISO string over HTTP`)
      return 'string'
    }
    case 'null':
      return 'null'
    case 'undefined':
    case 'void':
      return 'undefined'
    case 'nan':
      return 'number'
    case 'any':
    case 'unknown':
      return 'unknown'
    case 'never':
      return 'never'
    case 'literal': {
      const value = descriptor.values?.[0]
      if (value === null) return 'null'
      if (typeof value === 'string') return JSON.stringify(value)
      if (typeof value === 'number' || typeof value === 'boolean') return String(value)
      warnings.push(`${path}: unsupported literal value emitted as unknown`)
      return 'unknown'
    }
    case 'enum': {
      const values = descriptor.values ?? []
      if (values.length === 0) {
        warnings.push(`${path}: unsupported enum values emitted as unknown`)
        return 'unknown'
      }
      return values.map(value => JSON.stringify(value)).join(' | ')
    }
    case 'array':
    case 'set': {
      const element = descriptor.element
      return `Array<${element ? emitTsType(element, mode, warnings, `${path}[]`) : 'unknown'}>`
    }
    case 'tuple': {
      const items = (descriptor.items ?? []).map((item, index) => emitTsType(item, mode, warnings, `${path}[${index}]`))
      if (descriptor.rest) items.push(`...Array<${emitTsType(descriptor.rest, mode, warnings, `${path}[rest]`)}>`)
      return `[${items.join(', ')}]`
    }
    case 'object': {
      const members = Object.entries(descriptor.shape ?? {})
        .map(([key, value]) => emitMember(key, value, mode, warnings, path))
      if (members.length === 0) return 'Record<string, never>'
      return `{\n${members.join('\n')}\n}`
    }
    case 'union': {
      const options = descriptor.options ?? []
      if (options.length === 0) {
        warnings.push(`${path}: union without options emitted as unknown`)
        return 'unknown'
      }
      return options.map((option, index) => emitTsType(option, mode, warnings, `${path}[${index}]`)).join(' | ')
    }
    case 'intersection': {
      const left = descriptor.left ? emitTsType(descriptor.left, mode, warnings, `${path}.left`) : 'unknown'
      const right = descriptor.right ? emitTsType(descriptor.right, mode, warnings, `${path}.right`) : 'unknown'
      return `${left} & ${right}`
    }
    case 'record': {
      const value = descriptor.valueType ? emitTsType(descriptor.valueType, mode, warnings, `${path}.value`) : 'unknown'
      return `Record<string, ${value}>`
    }
    case 'refinement':
    case 'custom':
      return descriptor.inner ? emitTsType(descriptor.inner, mode, warnings, path) : 'unknown'
    case 'file':
      if (mode === 'input') return 'File'
      warnings.push(`${path}: File is only representable in request payloads (multipart); emitted as unknown`)
      return 'unknown'
    case 'pipe': {
      // transform / preprocess: the emitted type is the *input* type.
      const inner = descriptor.input ?? descriptor.output
      if (inner) {
        warnings.push(`${path}: ${descriptor.effect ?? 'transform'} is not representable — emitting the underlying schema type`)
        return emitTsType(inner, mode, warnings, path)
      }
      warnings.push(`${path}: effect without an inner type emitted as unknown`)
      return 'unknown'
    }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'catch':
    case 'readonly':
    case 'lazy': {
      const inner = descriptor.inner ?? descriptor.getter?.()
      if (inner) return emitTsType(inner, mode, warnings, path)
      warnings.push(`${path}: wrapper without an inner schema emitted as unknown`)
      return 'unknown'
    }
    default: {
      if (checks.some(check => check.kind === 'refinement')) {
        warnings.push(`${path}: refinements are not representable in TypeScript; they are omitted`)
      }
      warnings.push(`${path}: unsupported schema (${descriptor.rawKind ?? descriptor.kind}) emitted as unknown`)
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
  const descriptor = unwrapZodSchema(schema).descriptor
  if (descriptor.kind === 'object') {
    const members = Object.entries(descriptor.shape ?? {})
      .map(([key, value]) => emitMember(key, value, mode, warnings, path))
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



/**
 * OpenAPI generation layer. Completely isolated from runtime validation:
 * consumes contract objects, produces a JSON-serializable document.
 *
 * Unsupported Zod features (transform / refine / superRefine / preprocess)
 * are represented as closely as possible, a warning is collected and
 * generation of the whole document never fails.
 */
import type { ZodType } from 'zod'
import type { AnyApiContract } from '../runtime/shared/types'
import { isExternalContract } from '../runtime/shared/contract'
import { normalizeDeprecation } from '../runtime/shared/versioning'

export type JsonSchemaObject = Record<string, unknown>

export interface GenerationWarning {
  contract: string
  message: string
}

export interface OpenApiOptions {
  title?: string
  version?: string
  description?: string
}

export interface OpenApiGenerationResult {
  document: Record<string, unknown>
  warnings: GenerationWarning[]
}

/** Runtime shape of a Zod schema definition (zod 3 internals). */
interface ZodDefLike {
  typeName?: string
  shape?: Record<string, ZodType> | (() => Record<string, ZodType>)
  innerType?: ZodType
  options?: ZodType[]
  value?: unknown
  values?: unknown[]
  items?: ZodType[]
  valueType?: ZodType
  type?: ZodType
  checks?: Array<{ kind?: string, value?: unknown }>
  description?: string
  effect?: { type?: string }
  schema?: ZodType
  left?: ZodType
  right?: ZodType
  defaultValue?: unknown
}

/** Accesses zod internals through a typed boundary. */
function zodDef(schema: ZodType): ZodDefLike {
  return (schema as unknown as { _def: ZodDefLike })._def
}

/** Converts a path like `/api/users/:id` into `/api/users/{id}`. */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
}

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!)
}

/**
 * Converts a Zod schema into a JSON schema. Best-effort: anything not
 * directly representable falls back to the inner schema or an empty schema
 * plus a warning.
 */
export function zodToJsonSchema(schema: ZodType, warnings: GenerationWarning[], contractLabel: string): JsonSchemaObject {
  const def = zodDef(schema)
  const kind = def.typeName ?? 'unknown'
  const description = def.description

  const base = (schema: JsonSchemaObject): JsonSchemaObject => (description ? { ...schema, description } : schema)

  switch (kind) {
    case 'ZodString': {
      const result: JsonSchemaObject = { type: 'string' }
      for (const check of def.checks ?? []) {
        switch (check.kind) {
          case 'email': result.format = 'email'; break
          case 'uuid': result.format = 'uuid'; break
          case 'datetime': result.format = 'date-time'; break
          case 'url': result.format = 'uri'; break
          case 'min': result.minLength = check.value; break
          case 'max': result.maxLength = check.value; break
          default: break
        }
      }
      return base(result)
    }
    case 'ZodNumber': {
      const result: JsonSchemaObject = { type: 'number' }
      for (const check of def.checks ?? []) {
        switch (check.kind) {
          case 'int': result.type = 'integer'; break
          case 'min': result.minimum = check.value; break
          case 'max': result.maximum = check.value; break
          case 'multipleOf': result.multipleOf = check.value; break
          default: break
        }
      }
      return base(result)
    }
    case 'ZodBoolean': return base({ type: 'boolean' })
    case 'ZodNull': return base({ type: 'null' })
    case 'ZodDate': return base({ type: 'string', format: 'date-time' })
    case 'ZodLiteral': return base({ enum: [def.value], type: typeof def.value })
    case 'ZodEnum': return base({ enum: def.values, type: typeof (def.values?.[0]) })
    case 'ZodArray': {
      const element = def.type ?? def.innerType
      return base({
        type: 'array',
        items: element ? zodToJsonSchema(element, warnings, contractLabel) : {},
      })
    }
    case 'ZodObject': {
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape
      const properties: Record<string, JsonSchemaObject> = {}
      const required: string[] = []
      for (const [key, value] of Object.entries(shape ?? {})) {
        properties[key] = zodToJsonSchema(value, warnings, contractLabel)
        if (!isOptional(value)) required.push(key)
      }
      const result: JsonSchemaObject = { type: 'object', properties }
      if (required.length > 0) result.required = required
      return base(result)
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      return base({
        anyOf: (def.options ?? []).map(option => zodToJsonSchema(option, warnings, contractLabel)),
      })
    }
    case 'ZodIntersection': {
      return base({
        allOf: [def.left, def.right]
          .filter((part): part is ZodType => Boolean(part))
          .map(part => zodToJsonSchema(part, warnings, contractLabel)),
      })
    }
    case 'ZodRecord': {
      return base({
        type: 'object',
        additionalProperties: def.valueType ? zodToJsonSchema(def.valueType, warnings, contractLabel) : {},
      })
    }
    case 'ZodTuple': {
      return base({
        type: 'array',
        items: { anyOf: (def.items ?? []).map(item => zodToJsonSchema(item, warnings, contractLabel)) },
      })
    }
    case 'ZodOptional': {
      if (def.innerType) return zodToJsonSchema(def.innerType, warnings, contractLabel)
      return base({})
    }
    case 'ZodNullable': {
      const inner = def.innerType ? zodToJsonSchema(def.innerType, warnings, contractLabel) : {}
      return base({ ...inner, nullable: true })
    }
    case 'ZodDefault': {
      const inner = def.innerType ? zodToJsonSchema(def.innerType, warnings, contractLabel) : {}
      let defaultValue: unknown
      try {
        defaultValue = typeof def.defaultValue === 'function' ? (def.defaultValue as () => unknown)() : def.defaultValue
      } catch {
        defaultValue = undefined
      }
      return base({ ...inner, default: defaultValue })
    }
    case 'ZodCatch':
    case 'ZodBranded': {
      return def.innerType ? zodToJsonSchema(def.innerType, warnings, contractLabel) : base({})
    }
    case 'ZodEffects': {
      // transform / refine / preprocess: represent the inner schema, warn.
      warnings.push({
        contract: contractLabel,
        message: `Zod effects (${def.effect?.type ?? 'unknown'}) cannot be represented in OpenAPI; the inner schema is used.`,
      })
      const inner = def.schema ?? def.innerType
      return inner ? zodToJsonSchema(inner, warnings, contractLabel) : base({})
    }
    default: {
      warnings.push({
        contract: contractLabel,
        message: `Unsupported Zod kind "${kind}" cannot be represented in OpenAPI; an empty schema is emitted.`,
      })
      return base({})
    }
  }
}

function isOptional(schema: ZodType): boolean {
  const typeName = zodDef(schema).typeName
  return typeName === 'ZodOptional' || typeName === 'ZodDefault'
}

function extractShapeProperty(
  schema: ZodType,
  name: string,
  warnings: GenerationWarning[],
  label: string,
): JsonSchemaObject | undefined {
  const def = zodDef(schema)
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape
  if (def.typeName === 'ZodObject' && shape?.[name]) {
    return zodToJsonSchema(shape[name]!, warnings, label)
  }
  warnings.push({
    contract: label,
    message: `Params schema is not a plain ZodObject; path parameter "${name}" defaults to { type: string }.`,
  })
  return undefined
}

function hasOptionalTopLevel(schema: ZodType): boolean {
  const json = zodToJsonSchema(schema, [], '(internal)')
  return !((json.required as string[])?.length)
}

/** Builds one OpenAPI operation from a contract. */
export function contractToOperation(contract: AnyApiContract, warnings: GenerationWarning[]): JsonSchemaObject {
  const label = contract.name ?? `${contract.method} ${contract.path}`
  const parameters: JsonSchemaObject[] = []
  const operation: JsonSchemaObject = {
    operationId: contract.name ?? `${contract.method.toLowerCase()}_${toOpenApiPath(contract.path).replace(/[^A-Za-z0-9]/g, '_')}`,
    summary: contract.summary ?? label,
    parameters,
  }
  if (contract.description) operation.description = contract.description
  if (contract.tags?.length) operation.tags = [...contract.tags]

  for (const name of pathParamNames(contract.path)) {
    const schema = contract.params
      ? extractShapeProperty(contract.params as ZodType, name, warnings, label)
      : undefined
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: schema ?? { type: 'string' },
    })
  }

  if (contract.query) {
    const querySchema = zodToJsonSchema(contract.query as ZodType, warnings, label)
    const properties = (querySchema.properties ?? {}) as Record<string, JsonSchemaObject>
    const required = (querySchema.required ?? []) as string[]
    for (const [name, schema] of Object.entries(properties)) {
      parameters.push({ name, in: 'query', required: required.includes(name), schema })
    }
  }

  if (contract.headers) {
    const headersSchema = zodToJsonSchema(contract.headers as ZodType, warnings, label)
    const properties = (headersSchema.properties ?? {}) as Record<string, JsonSchemaObject>
    const required = (headersSchema.required ?? []) as string[]
    for (const [name, schema] of Object.entries(properties)) {
      parameters.push({ name, in: 'header', required: required.includes(name), schema })
    }
  }

  if (contract.body) {
    operation.requestBody = {
      required: !hasOptionalTopLevel(contract.body as ZodType),
      content: { 'application/json': { schema: zodToJsonSchema(contract.body as ZodType, warnings, label) } },
    }
  }

  const responses: Record<string, JsonSchemaObject> = {}
  responses['200'] = contract.response
    ? {
        description: contract.summary ?? 'Successful response',
        content: { 'application/json': { schema: zodToJsonSchema(contract.response as ZodType, warnings, label) } },
      }
    : { description: 'Successful response' }
  if (contract.params || contract.query || contract.body || contract.headers) {
    responses['400'] = {
      description: 'Request validation error',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiValidationError' } } },
    }
  }
  responses.default = {
    description: 'Unified API error',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
  }
  operation.responses = responses
  if (contract.errors) {
    operation['x-error-codes'] = Object.keys(contract.errors)
  }
  // --- 0.6.0 contract versioning: deprecation metadata ---
  const deprecation = normalizeDeprecation(contract.deprecated)
  if (deprecation) {
    operation.deprecated = true
    if (deprecation.since !== undefined) operation['x-deprecated-since'] = deprecation.since
    if (deprecation.sunset) operation['x-deprecated-sunset'] = deprecation.sunset
    if (deprecation.message) operation.description = [operation.description, `Deprecated: ${deprecation.message}`].filter(Boolean).join('\n\n')
  }
  return operation
}

/**
 * Generates a complete OpenAPI 3.0 document from contracts.
 * Never throws: invalid pieces degrade to warnings.
 */
export function generateOpenApiDocument(
  contracts: AnyApiContract[],
  options: OpenApiOptions = {},
): OpenApiGenerationResult {
  const warnings: GenerationWarning[] = []
  const paths: Record<string, Record<string, JsonSchemaObject>> = {}

  for (const contract of contracts) {
    if (isExternalContract(contract)) {
      // External API contracts are not local Nitro operations — representing
      // them in the document would produce wrong server declarations.
      warnings.push({
        contract: contract.name ?? contract.path,
        message: `External contract (${contract.baseUrl ?? contract.path}) skipped from OpenAPI generation.`,
      })
      continue
    }
    const openApiPath = toOpenApiPath(contract.path)
    paths[openApiPath] ??= {}
    const key = contract.method.toLowerCase()
    if (paths[openApiPath]![key]) {
      warnings.push({
        contract: contract.name ?? contract.path,
        message: `Duplicate operation ${contract.method} ${openApiPath}; the previous definition is overwritten.`,
      })
    }
    paths[openApiPath]![key] = contractToOperation(contract, warnings)
  }

  const document = {
    openapi: '3.0.3',
    info: {
      title: options.title ?? 'API Contracts',
      version: options.version ?? '0.1.0',
      ...(options.description ? { description: options.description } : {}),
    },
    paths,
    components: {
      schemas: {
        ApiError: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                statusCode: { type: 'number' },
              },
              required: ['code', 'message'],
            },
          },
          required: ['error'],
        },
        ApiValidationError: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['VALIDATION_ERROR'] },
                message: { type: 'string' },
                issues: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      path: { type: 'string' },
                      message: { type: 'string' },
                      expected: { type: 'string' },
                    },
                    required: ['path', 'message'],
                  },
                },
              },
              required: ['code', 'message'],
            },
          },
          required: ['error'],
        },
      },
    },
  }

  return { document, warnings }
}

/** Helper for CLI / tooling: filters a list of unknown values down to contracts. */
export function pickContracts(values: unknown[]): AnyApiContract[] {
  return values.filter(
    value => typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'api-contract',
  ) as AnyApiContract[]
}

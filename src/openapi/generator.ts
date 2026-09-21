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
import { describeZodSchema, unwrapZodSchema } from '../runtime/shared/zod-schema'
import type { ZodCheck } from '../runtime/shared/zod-schema'

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

/* ------------------------------------------------------------------ *
 * Zod -> JSON Schema
 * ------------------------------------------------------------------ */

/** Converts a path like `/api/users/:id` into `/api/users/{id}`. */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
}

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!)
}

/** Applies normalized string checks to an OpenAPI schema object. */
function applyStringChecks(result: JsonSchemaObject, checks: ZodCheck[]): JsonSchemaObject {
  for (const check of checks) {
    switch (check.kind) {
      case 'format':
        switch (check.format) {
          case 'email': result.format = 'email'; break
          case 'uuid': result.format = 'uuid'; break
          case 'url': result.format = 'uri'; break
          case 'datetime': result.format = 'date-time'; break
          case 'date': result.format = 'date'; break
          case 'time': result.format = 'time'; break
          case 'duration': result.format = 'duration'; break
          case 'ip':
          case 'ipv4': result.format = 'ipv4'; break
          case 'ipv6': result.format = 'ipv6'; break
          // startsWith / endsWith / includes / emoji / cuid / jwt … have no
          // OpenAPI equivalent: skipped rather than misrepresented.
          default: break
        }
        break
      case 'regex':
        if (check.pattern) result.pattern = check.pattern
        break
      case 'min':
        if (typeof check.value === 'number') result.minLength = check.value
        break
      case 'max':
        if (typeof check.value === 'number') result.maxLength = check.value
        break
      case 'length':
        if (typeof check.value === 'number') {
          result.minLength = check.value
          result.maxLength = check.value
        }
        break
      default:
        break
    }
  }
  return result
}

/** Applies normalized numeric checks (OpenAPI 3.0 exclusive bounds are flags). */
function applyNumberChecks(result: JsonSchemaObject, checks: ZodCheck[]): JsonSchemaObject {
  for (const check of checks) {
    switch (check.kind) {
      case 'int':
        result.type = 'integer'
        break
      case 'min':
        if (typeof check.value === 'number') {
          result.minimum = check.value
          if (check.inclusive === false) result.exclusiveMinimum = true
        }
        break
      case 'max':
        if (typeof check.value === 'number') {
          result.maximum = check.value
          if (check.inclusive === false) result.exclusiveMaximum = true
        }
        break
      case 'multipleOf':
        if (typeof check.value === 'number') result.multipleOf = check.value
        break
      default:
        break
    }
  }
  return result
}

/** Applies min/max/length checks to arrays and sets. */
function applySizeChecks(result: JsonSchemaObject, checks: ZodCheck[]): JsonSchemaObject {
  for (const check of checks) {
    if (typeof check.value !== 'number') continue
    if (check.kind === 'min') result.minItems = check.value
    else if (check.kind === 'max') result.maxItems = check.value
    else if (check.kind === 'length') {
      result.minItems = check.value
      result.maxItems = check.value
    }
  }
  return result
}


/**
 * Converts a Zod schema into an OpenAPI-flavored JSON schema. Best-effort:
 * anything not directly representable degrades to the closest schemable form
 * plus a warning — generation of the whole document never fails.
 */
export function zodToJsonSchema(
  schema: ZodType,
  warnings: GenerationWarning[],
  contractLabel: string,
  path = 'schema',
): JsonSchemaObject {
  const topDescriptor = describeZodSchema(schema)
  const { descriptor, checks, nullable, hasDefault, defaultValue } = unwrapZodSchema(schema)

  const described = (json: JsonSchemaObject): JsonSchemaObject => {
    const description = topDescriptor.description ?? descriptor.description
    let result = description ? { ...json, description } : json
    if (hasDefault && defaultValue !== undefined) result = { ...result, default: defaultValue }
    if (nullable) result = { ...result, nullable: true }
    if (json.type === 'array') result = applySizeChecks(result, checks)
    return result
  }

  if (checks.some(check => check.kind === 'refinement')) {
    warnings.push({
      contract: contractLabel,
      message: `${path}: refinements cannot be represented in OpenAPI; the underlying schema is emitted without them.`,
    })
  }

  const recurse = (inner: ZodType | undefined, suffix = ''): JsonSchemaObject =>
    inner ? zodToJsonSchema(inner, warnings, contractLabel, suffix ? `${path}.${suffix}` : path) : {}

  switch (descriptor.kind) {
    case 'string':
      return described(applyStringChecks({ type: 'string' }, checks))
    case 'number':
      return described(applyNumberChecks({ type: 'number' }, checks))
    case 'boolean':
      return described({ type: 'boolean' })
    case 'bigint':
      // Serialized as a JSON string (see serialization notes in the README).
      return described({ type: 'string', format: 'int64' })
    case 'date':
      return described({ type: 'string', format: 'date-time' })
    case 'null':
      return described({ nullable: true, enum: [null] })
    case 'file':
      return described({ type: 'string', format: 'binary' })
    case 'literal': {
      const value = descriptor.values?.[0]
      return described({ enum: [value], type: value === null ? 'null' : typeof value })
    }
    case 'enum': {
      const values = descriptor.values ?? []
      return described({ enum: values, type: typeof values[0] })
    }
    case 'array':
      return described(applySizeChecks({ type: 'array', items: recurse(descriptor.element, '[]') }, checks))
    case 'set':
      return described(applySizeChecks({ type: 'array', items: recurse(descriptor.element, '[]'), uniqueItems: true }, checks))
    case 'object': {
      const properties: Record<string, JsonSchemaObject> = {}
      const required: string[] = []
      for (const [key, value] of Object.entries(descriptor.shape ?? {})) {
        properties[key] = zodToJsonSchema(value, warnings, contractLabel, `${path}.${key}`)
        const unwrapped = unwrapZodSchema(value)
        if (!unwrapped.optional && !unwrapped.hasDefault) required.push(key)
      }
      const result: JsonSchemaObject = { type: 'object', properties }
      if (required.length > 0) result.required = required
      if (descriptor.unknownKeys === 'strict') result.additionalProperties = false
      return described(result)
    }
    case 'union': {
      const anyOf = (descriptor.options ?? []).map((option, index) => zodToJsonSchema(option, warnings, contractLabel, `${path}[${index}]`))
      const result: JsonSchemaObject = { anyOf }
      if (descriptor.discriminatedBy) result.discriminator = { propertyName: descriptor.discriminatedBy }
      return described(result)
    }
    case 'intersection':
      return described({
        allOf: [descriptor.left, descriptor.right]
          .filter((part): part is ZodType => Boolean(part))
          .map((part, index) => zodToJsonSchema(part, warnings, contractLabel, `${path}.allOf[${index}]`)),
      })
    case 'record':
    case 'map':
      return described({ type: 'object', additionalProperties: recurse(descriptor.valueType, '{}') })
    case 'tuple':
      return described({
        type: 'array',
        items: { anyOf: (descriptor.items ?? []).map((item, index) => zodToJsonSchema(item, warnings, contractLabel, `${path}[${index}]`)) },
      })
    case 'pipe':
      warnings.push({
        contract: contractLabel,
        message: `${path}: Zod effects (${descriptor.effect ?? 'unknown'}) cannot be represented in OpenAPI; the input schema is used.`,
      })
      return recurse(descriptor.input ?? descriptor.output)
    case 'any':
    case 'unknown':
      // Any JSON value is representable.
      return described({})
    case 'optional':
    case 'nullable':
    case 'default':
    case 'catch':
    case 'readonly':
      // Reached only when a wrapper had no inner schema.
      return recurse(descriptor.inner)
    default: {
      warnings.push({
        contract: contractLabel,
        message: `${path}: unsupported Zod kind "${descriptor.rawKind ?? descriptor.kind}" cannot be represented in OpenAPI; an empty schema is emitted.`,
      })
      return described({})
    }
  }
}

function extractShapeProperty(
  schema: ZodType,
  name: string,
  warnings: GenerationWarning[],
  label: string,
): JsonSchemaObject | undefined {
  const descriptor = describeZodSchema(schema)
  if (descriptor.kind === 'object') {
    const property = descriptor.shape?.[name]
    if (property) return zodToJsonSchema(property, warnings, label)
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
    const multipart = contract.bodyFormat === 'multipart'
    operation.requestBody = {
      required: !hasOptionalTopLevel(contract.body as ZodType),
      content: multipart
        ? { 'multipart/form-data': { schema: zodToJsonSchema(contract.body as ZodType, warnings, label) } }
        : { 'application/json': { schema: zodToJsonSchema(contract.body as ZodType, warnings, label) } },
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
                      code: { type: 'string' },
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

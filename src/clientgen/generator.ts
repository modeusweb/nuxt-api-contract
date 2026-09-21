/**
 * OpenAPI-style client generation: consumes contract objects and produces a
 * standalone, dependency-free TypeScript client (global fetch) that external
 * consumers (another app, a script, a service) can use against the deployed
 * API. Build-time only — never imported by the runtime.
 */
import type { ZodType } from 'zod'
import type { AnyApiContract, HttpMethod } from '../runtime/shared/types'
import { unwrapZodSchema } from '../runtime/shared/zod-schema'
import { emitMember, emitNamedType, emitTsType, pathParamNames } from './zodToTs'

export interface GenerationWarning {
  contract: string
  message: string
}

export interface ClientGenerationOptions {
  /** Name of the exported factory function (default `createClient`). */
  factoryName?: string
}

export interface ClientGenerationResult {
  source: string
  warnings: GenerationWarning[]
}

interface GeneratedOperation {
  /** Unique method name on the client object. */
  method: string
  /** HTTP method. */
  httpMethod: HttpMethod
  contract: AnyApiContract
  /** Base name for emitted types (Params / Query / Body / Response). */
  typeName: string
  /** The client must always send params. */
  requiresParams: boolean
  /** The client must always send a body. */
  requiresBody: boolean
  /** The params schema is a ZodObject (merged interface emission). */
  paramsIsObject: boolean
}

function pascal(input: string): string {
  return input
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(part => part[0]!.toUpperCase() + part.slice(1))
    .join('')
}

function camel(input: string): string {
  const p = pascal(input)
  return p ? p[0]!.toLowerCase() + p.slice(1) : 'op'
}

/** Derives the client method name (camelCase) for a contract. */
function operationMethodName(contract: AnyApiContract, used: Set<string>): string {
  let name = contract.name ? camel(contract.name) : camel(`${contract.method.toLowerCase()} ${contract.path}`)
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) name = `op${pascal(name)}`
  let candidate = name
  let counter = 2
  while (used.has(candidate)) candidate = `${name}${counter++}`
  used.add(candidate)
  return candidate
}

/** Derives the PascalCase type base name for a contract. */
function contractTypeName(contract: AnyApiContract, used: Set<string>): string {
  const name = contract.name ? pascal(contract.name) : pascal(`${contract.method.toLowerCase()} ${contract.path}`)
  let candidate = name
  let counter = 2
  while (used.has(candidate)) candidate = `${name}${counter++}`
  used.add(candidate)
  return candidate
}

/** True when the top-level schema has at least one required property. */
function hasRequiredProp(schema: ZodType): boolean {
  const descriptor = unwrapZodSchema(schema).descriptor
  if (descriptor.kind !== 'object') return true
  return Object.values(descriptor.shape ?? {}).some((value) => {
    const unwrapped = unwrapZodSchema(value)
    return !unwrapped.optional && !unwrapped.hasDefault && !unwrapped.nullable
  })
}

/** Computes requiredness flags for one operation. */
function computeInputShape(contract: AnyApiContract): Pick<GeneratedOperation, 'requiresParams' | 'requiresBody' | 'paramsIsObject'> {
  const pathNames = pathParamNames(contract.path)
  let schemaRequired = false
  let paramsIsObject = false
  if (contract.params) {
    const descriptor = unwrapZodSchema(contract.params as ZodType).descriptor
    if (descriptor.kind === 'object') {
      paramsIsObject = true
      schemaRequired = hasRequiredProp(contract.params as ZodType)
    } else {
      schemaRequired = true
    }
  }
  const bodyRequired = contract.body ? hasRequiredProp(contract.body as ZodType) : false
  return {
    requiresParams: pathNames.length > 0 || schemaRequired,
    requiresBody: bodyRequired,
    paramsIsObject,
  }
}

/** Emits the Params / Query / Body / Headers / Response type declarations. */
function emitTypeDeclarations(operation: GeneratedOperation, warnings: string[]): string[] {
  const contract = operation.contract
  const pathNames = pathParamNames(contract.path)
  const declarations: string[] = []
  const base = operation.typeName

  if (contract.params || pathNames.length > 0) {
    if (contract.params && operation.paramsIsObject) {
      const shape = unwrapZodSchema(contract.params as ZodType).descriptor.shape ?? {}
      const lines = Object.entries(shape).map(([key, value]) => emitMember(key, value, 'input', warnings, `${operation.method}.params`))
      for (const name of pathNames) {
        if (!(name in shape)) lines.push(`  ${JSON.stringify(name)}: string`)
      }
      declarations.push(`export interface ${base}Params {\n${lines.join('\n')}\n}`)
    } else if (contract.params) {
      const inner = emitTsType(contract.params as ZodType, 'input', warnings, `${operation.method}.params`)
      const literal = pathNames.length > 0
        ? ` & { ${pathNames.map(name => `${JSON.stringify(name)}: string`).join(', ')} }`
        : ''
      declarations.push(`export type ${base}Params = ${inner}${literal}`)
    } else {
      const lines = pathNames.map(name => `  ${JSON.stringify(name)}: string`)
      declarations.push(`export interface ${base}Params {\n${lines.join('\n')}\n}`)
    }
  }

  if (contract.query) {
    const declaration = emitNamedType(`${base}Query`, contract.query as ZodType, 'input', warnings, `${operation.method}.query`)
    if (declaration) declarations.push(declaration)
  }
  if (contract.body) {
    const declaration = emitNamedType(`${base}Body`, contract.body as ZodType, 'input', warnings, `${operation.method}.body`)
    if (declaration) declarations.push(declaration)
  }
  if (contract.headers) {
    const declaration = emitNamedType(`${base}Headers`, contract.headers as ZodType, 'input', warnings, `${operation.method}.headers`)
    if (declaration) declarations.push(declaration)
  }
  if (contract.response) {
    const declaration = emitNamedType(`${base}Response`, contract.response as ZodType, 'output', warnings, `${operation.method}.response`)
    if (declaration) declarations.push(declaration)
  }
  return declarations
}

/** Emits the generated method for one operation. */
function emitOperation(operation: GeneratedOperation): string {
  const contract = operation.contract
  const hasParams = contract.params !== undefined || pathParamNames(contract.path).length > 0
  const paramsRef = hasParams ? 'input?.params' : 'undefined'
  const queryRef = contract.query ? 'input?.query' : 'undefined'
  const bodyRef = contract.body ? 'input?.body' : 'undefined'
  const headersRef = contract.headers ? 'input?.headers' : 'undefined'
  const responseType = contract.response ? `${operation.typeName}Response` : 'unknown'

  const inputParts: string[] = []
  if (hasParams) inputParts.push(`params${operation.requiresParams ? '' : '?'}: ${operation.typeName}Params`)
  if (contract.query) inputParts.push(`query?: ${operation.typeName}Query`)
  if (contract.body) inputParts.push(`body${operation.requiresBody ? '' : '?'}: ${operation.typeName}Body`)
  if (contract.headers) inputParts.push(`headers?: ${operation.typeName}Headers`)

  const needsInput = inputParts.length > 0
  const inputType = needsInput ? `{\n    ${inputParts.join('\n    ')}\n  }` : null
  const signature = needsInput
    ? `input: ${inputType}, options?: { signal?: AbortSignal, extraHeaders?: Record<string, string> }`
    : `options?: { signal?: AbortSignal, extraHeaders?: Record<string, string> }`

  const summary = (contract.summary ?? contract.description ?? '').replace(/\*\//g, '')
  const comment = `  /** ${operation.httpMethod} ${contract.path}${contract.name ? ` (${contract.name})` : ''}${summary ? ` — ${summary}` : ''} */`

  return [
    comment,
    `  async ${operation.method}(${signature}): Promise<${responseType}> {`,
    `    const result = await request(`,
    `      '${operation.httpMethod}',`,
    `      buildPath('${contract.path}', ${paramsRef}) + buildQueryString(${queryRef}),`,
    `      ${bodyRef},`,
    `      ${headersRef},`,
    `      options?.signal,`,
    `      options?.extraHeaders,`,
    `    )`,
    `    return result as ${responseType}`,
    `  },`,
  ].join('\n')
}

const RUNTIME_PRELUDE = `export interface ContractClientErrorPayload {
  code: string
  message: string
  statusCode: number
  issues?: Array<{ path: string, message: string }>
}

/** Thrown when the API responds with a non-2xx status or the request is malformed. */
export class ContractClientError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly issues?: Array<{ path: string, message: string }>
  constructor(payload: ContractClientErrorPayload) {
    super(payload.message)
    this.name = 'ContractClientError'
    this.code = payload.code
    this.statusCode = payload.statusCode
    this.issues = payload.issues
  }
}

export interface ContractClientConfig {
  /** Base URL prepended to every contract path. */
  baseUrl?: string
  /** Custom fetch implementation. */
  fetch?: typeof globalThis.fetch
  /** Static or dynamic headers merged into every request (e.g. Authorization). */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)
}

function buildPath(path: string, params: Record<string, unknown> | undefined): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match: string, name: string) => {
    const value = params === undefined || params === null ? undefined : params[name]
    if (value === undefined || value === null) {
      throw new ContractClientError({ code: 'VALIDATION_ERROR', message: \`Missing path parameter "\${name}" for \${path}\`, statusCode: 400 })
    }
    return encodeURIComponent(String(value))
  })
}

function buildQueryString(query: Record<string, unknown> | undefined): string {
  if (!query) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item))
    } else {
      search.append(key, String(value))
    }
  }
  const encoded = search.toString()
  return encoded ? \`?\${encoded}\` : ''
}`

const FACTORY_BODY = `  const doFetch = config.fetch ?? globalThis.fetch
  const baseUrl = (config.baseUrl ?? '').replace(/\\/+$/, '')

  async function resolveHeaders(): Promise<Record<string, string>> {
    if (typeof config.headers === 'function') return { ...(await config.headers()) }
    return { ...config.headers }
  }

  async function request(
    method: string,
    url: string,
    body: unknown,
    headers: Record<string, string> | undefined,
    signal: AbortSignal | undefined,
    extraHeaders: Record<string, string> | undefined,
  ): Promise<unknown> {
    const allHeaders: Record<string, string> = { ...await resolveHeaders(), ...headers, ...extraHeaders }
    if (body !== undefined) allHeaders['content-type'] = allHeaders['content-type'] ?? 'application/json'
    const response = await doFetch(\`\${baseUrl}\${url}\`, {
      method,
      headers: allHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
    if (!response.ok) {
      let payload: unknown
      try { payload = await response.json() } catch { payload = undefined }
      const err = (payload as { error?: { code?: string, message?: string, issues?: Array<{ path: string, message: string }> } } | undefined)?.error
      throw new ContractClientError({
        code: err?.code ?? 'HTTP_ERROR',
        message: err?.message ?? \`\${method} \${url} failed with status \${response.status}\`,
        statusCode: response.status,
        issues: Array.isArray(err?.issues) ? err.issues : undefined,
      })
    }
    if (response.status === 204 || method === 'HEAD') return undefined
    const text = await response.text()
    if (!text) return undefined
    return JSON.parse(text)
  }`

/**
 * Generates a standalone TypeScript client from contract objects.
 * The produced source has zero dependencies (uses global fetch) and can be
 * committed into any consumer project.
 */
export function generateClientSource(
  contracts: AnyApiContract[],
  options: ClientGenerationOptions = {},
): ClientGenerationResult {
  const warnings: string[] = []
  const factoryName = options.factoryName ?? 'createClient'
  const usedMethods = new Set<string>()
  const usedTypeNames = new Set<string>()

  const operations: GeneratedOperation[] = contracts.map((contract) => {
    const shape = computeInputShape(contract)
    return {
      method: operationMethodName(contract, usedMethods),
      httpMethod: contract.method,
      contract,
      typeName: contractTypeName(contract, usedTypeNames),
      requiresParams: shape.requiresParams,
      requiresBody: shape.requiresBody,
      paramsIsObject: shape.paramsIsObject,
    }
  })

  const declarationLines: string[] = []
  const operationLines: string[] = []
  for (const operation of operations) {
    declarationLines.push(...emitTypeDeclarations(operation, warnings))
    operationLines.push(emitOperation(operation))
  }

  const header = [
    '/**',
    ' * Generated by `npx nuxt-api-contract client`. Do not edit manually —',
    ' * re-run the generator against the updated contracts instead.',
    ` * ${operations.length} operation(s).`,
    ' */',
    '/* eslint-disable */',
    '',
  ].join('\n')

  const factory = [
    `export function ${factoryName}(config: ContractClientConfig = {}) {`,
    FACTORY_BODY,
    '',
    '  return {',
    operationLines.join('\n\n'),
    '  }',
    '}',
  ].join('\n')

  const source = [
    header,
    RUNTIME_PRELUDE,
    '',
    declarationLines.join('\n\n'),
    '',
    factory,
    '',
  ].join('\n')

  return {
    source,
    warnings: warnings.map(message => ({ contract: message.split(':')[0] ?? 'unknown', message })),
  }
}
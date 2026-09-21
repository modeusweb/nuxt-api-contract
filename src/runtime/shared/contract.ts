import type {
  AnyApiContract,
  ApiContractDefinition,
  ContractClientResponse,
  ContractFromDefinition,
  ContractHandlerResponse, MaybePromise 
} from './types'
import { API_CONTRACT_KIND } from './types'
import { resolveBodyFormat } from './multipart'


/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

const REGISTRY_KEY = Symbol.for('nuxt-api-contract.registry')

interface RegistryStore {
  /** Canonical contracts keyed by `name#v<version>` (or plain `name` when unversioned). */
  contracts: Map<string, AnyApiContract>
  /** Latest registered contract per name (used by `getContractByName`). */
  latest: Map<string, AnyApiContract>
}

function canonicalKey(contract: Pick<AnyApiContract, 'name' | 'version'>): string {
  return contract.version !== undefined ? `${contract.name}#v${contract.version}` : contract.name!
}

function getStore(): RegistryStore {
  const globalThis_ = globalThis as typeof globalThis & { [REGISTRY_KEY]?: RegistryStore }
  if (!globalThis_[REGISTRY_KEY]) {
    globalThis_[REGISTRY_KEY] = { contracts: new Map(), latest: new Map() }
  }
  return globalThis_[REGISTRY_KEY]
}

/**
 * Registers a named contract. Called automatically by `defineApiContract`
 * when a `name` is provided. Same-name contracts with different `version`s
 * are stored side by side (0.6.0 contract versioning); re-registering the
 * same name+version overwrites the previous definition.
 *
 * Re-registration is expected (dev HMR, build-time OpenAPI loading + runtime)
 * and stays silent; a warning is only logged when the same name+version maps
 * to a *different* operation, which is a genuine conflict.
 */
export function registerContract(contract: AnyApiContract): void {
  if (!contract.name) return
  const store = getStore()
  const key = canonicalKey(contract)
  const existing = store.contracts.get(key)
  if (existing && existing !== contract && (existing.method !== contract.method || existing.path !== contract.path)) {
    console.warn(
      `[nuxt-api-contract] Duplicate contract name "${contract.name}"${contract.version !== undefined ? ` (v${contract.version})` : ''} `
      + `maps to ${contract.method} ${contract.path} but was already registered as ${existing.method} ${existing.path}. The latest definition wins.`,
    )
  }
  store.contracts.set(key, contract)
  store.latest.set(contract.name, contract)
}

export function getContractByName(name: string): AnyApiContract | undefined {
  return getStore().latest.get(name)
}

export function listRegisteredContracts(): AnyApiContract[] {
  return [...getStore().contracts.values()]
}

/** Test helper: clears the registry. */
export function clearContractRegistry(): void {
  const store = getStore()
  store.contracts.clear()
  store.latest.clear()
}

/* ------------------------------------------------------------------ *
 * Mocks
 * ------------------------------------------------------------------ */

const MOCK_STORE_KEY = Symbol.for('nuxt-api-contract.mocks')

const mockStore: Map<AnyApiContract, ContractMock<AnyApiContract>> = (
  (globalThis as typeof globalThis & { [MOCK_STORE_KEY]?: Map<AnyApiContract, ContractMock<AnyApiContract>> })[MOCK_STORE_KEY] ??= new Map()
)

export interface ContractMock<C extends AnyApiContract> {
  /** Factory producing a (validated) response for the contract. */
  response?: () => MaybePromise<MockResponseInput<C>>
  /** Simulated latency in ms. */
  delay?: number
}

export type MockResponseInput<C extends AnyApiContract> =
  C['response'] extends import('zod').ZodType ? ContractHandlerResponse<C> : unknown

/**
 * Registers a mock implementation for a contract. When the module option
 * `apiContract.mocks` is enabled, contract handlers return the mock response
 * (still validated against the response schema).
 */
export function mockContract<C extends AnyApiContract>(contract: C, mock: ContractMock<C>): void {
  mockStore.set(contract, mock as ContractMock<AnyApiContract>)
}

export function getContractMock<C extends AnyApiContract>(contract: C): ContractMock<C> | undefined {
  return mockStore.get(contract) as ContractMock<C> | undefined
}

/* ------------------------------------------------------------------ *
 * defineApiContract
 * ------------------------------------------------------------------ */

/**
 * Defines a type-safe API contract.
 *
 * The contract is the single source of truth for runtime validation,
 * TypeScript types, OpenAPI generation, DevTools and mocks.
 *
 * @example
 * ```ts
 * export const GetUser = defineApiContract({
 *   method: 'GET',
 *   path: '/api/users/:id',
 *   params: z.object({ id: z.string().uuid() }),
 *   response: z.object({ id: z.string(), name: z.string() }),
 * })
 * ```
 */
export function defineApiContract<const TDef extends ApiContractDefinition>(
  definition: TDef,
): ContractFromDefinition<TDef> {
  const contract = {
    kind: API_CONTRACT_KIND,
    name: definition.name,
    version: definition.version,
    method: definition.method,
    path: definition.path,
    baseUrl: definition.baseUrl,
    params: definition.params,
    query: definition.query,
    body: definition.body,
    bodyFormat: resolveBodyFormat({ body: definition.body, bodyFormat: definition.bodyFormat }),
    headers: definition.headers,
    response: definition.response,
    errors: definition.errors ? Object.freeze({ ...definition.errors }) : undefined,
    summary: definition.summary,
    description: definition.description,
    tags: definition.tags ? Object.freeze([...definition.tags]) : undefined,
    auth: definition.auth,
    deprecated: definition.deprecated,
    metadata: definition.metadata ? Object.freeze({ ...definition.metadata }) : undefined,
  } as unknown as ContractFromDefinition<TDef>

  Object.freeze(contract)

  if (definition.name) {
    registerContract(contract as AnyApiContract)
  }

  return contract
}

/** Type guard for contract objects. */
export function isApiContract(value: unknown): value is AnyApiContract {
  return (
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === API_CONTRACT_KIND
  )
}

/**
 * Builds the request URL from a contract path and concrete params.
 * Remaining params that are not part of the path are ignored.
 */
export function buildRequestPath(path: string, params: Record<string, unknown> | undefined): string {
  let url = path
  for (const match of path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const name = match[1]!
    const value = params?.[name]
    if (value === undefined || value === null) {
      throw new Error(`[nuxt-api-contract] Missing path parameter ":${name}" for ${path}`)
    }
    url = url.replace(`:${name}`, encodeURIComponent(String(value)))
  }
  return url
}

/** True when the contract points at an external API (absolute URL or `baseUrl`). */
export function isExternalContract(contract: AnyApiContract): boolean {
  if (contract.baseUrl !== undefined) return true
  return /^https?:\/\//i.test(contract.path)
}

/**
 * Resolves the full request URL for a contract:
 * - internal contracts: contract path only (relative to the Nuxt origin);
 * - external contracts: `baseUrl` joined with the path (or the absolute
 *   `path` itself) with path parameters substituted.
 */
export function resolveContractUrl(
  contract: Pick<AnyApiContract, 'path' | 'baseUrl'>,
  params: Record<string, unknown> | undefined,
): string {
  if (!isExternalContract(contract as AnyApiContract)) {
    return buildRequestPath(contract.path, params)
  }
  const base = contract.baseUrl?.replace(/\/+$/, '') ?? ''
  const path = base && !/^https?:\/\//i.test(contract.path)
    ? `${base}/${contract.path.replace(/^\/+/, '')}`
    : contract.path
  return buildRequestPath(path, params)
}

export type { ContractClientResponse }

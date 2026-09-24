/**
 * Standalone mock server: serves contract-defined endpoints with
 * deterministic generated responses. Zero framework dependencies — plain
 * `node:http`, so it can run outside Nuxt:
 *
 * ```bash
 * npx nuxt-api-contract mock contracts/index.ts --port 4000 --seed 42
 * ```
 */
import { createServer, type Server } from 'node:http'
import type { ZodType } from 'zod'
import type { AnyApiContract, HttpMethod } from '../runtime/shared/types'
import { ApiError, BUILT_IN_ERROR_CODES, serializeApiError, type ApiErrorPayload } from '../runtime/shared/errors'
import { isExternalContract } from '../runtime/shared/contract'
import { validateContractInput, validateContractResponse } from '../server/validation'
import { generateMockResponse } from '../runtime/shared/mock'

export interface MockServerOptions {
  contracts: AnyApiContract[]
  /** Listen port (default: 4000; `0` picks a random free port). */
  port?: number
  /** Listen host (default: `127.0.0.1`). */
  host?: string
  /** Deterministic generation seed. */
  seed?: number
  /** Artificial latency in ms per request. */
  delay?: number
  /** Return generated responses even for invalid requests (default: false). */
  lenient?: boolean
  /** Only serve contracts whose names are included in this list. */
  only?: readonly string[]
}

export interface MockServerHandle {
  server: Server
  port: number
  host: string
  url: string
  close: () => Promise<void>
}

interface Matcher {
  contract: AnyApiContract
  method: string
  regex: RegExp
  names: string[]
}

function pathToRegex(path: string): { regex: RegExp, names: string[] } {
  const names: string[] = []
  const source = path
    .split('/')
    .map((segment) => {
      const match = /^:([A-Za-z_][A-Za-z0-9_]*)$/.exec(segment)
      if (!match) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      names.push(match[1]!)
      return `(?<${match[1]}>[^/]+)`
    })
    .join('/')
  return { regex: new RegExp(`^${source}/?$`), names }
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, x-requested-with',
  }
}

function send(res: import('node:http').ServerResponse, status: number, payload: unknown, extra: Record<string, string> = {}): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-mock-server': 'nuxt-api-contract',
    ...corsHeaders(),
    ...extra,
  })
  res.end(body)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Builds an in-memory matcher index over the contracts. */
export function buildMockMatchers(contracts: AnyApiContract[], only?: readonly string[]): Matcher[] {
  return contracts
    .filter((contract) => {
      if (only && (!contract.name || !only.includes(contract.name))) return false
      if (isExternalContract(contract)) {
        console.warn(`[nuxt-api-contract] Mock server: external contract ${contract.name ?? contract.path} is skipped (external APIs are not mocked).`)
        return false
      }
      return true
    })
    .map(contract => {
      const { regex, names } = pathToRegex(contract.path)
      return { contract, method: contract.method, regex, names }
    })
}

/** Reads and JSON-parses a request body (never throws). */
async function readJsonBody(req: import('node:http').IncomingMessage): Promise<{ ok: boolean, value: unknown }> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { ok: false, value: undefined }
  }
}

function errorPayload(error: ApiError): ApiErrorPayload {
  return serializeApiError(error)
}

/**
 * Creates (without listening) a mock `node:http` server for the contracts.
 * Prefer `startMockServer` for CLI / test usage.
 */
export function createMockServer(options: MockServerOptions): Server {
  const matchers = buildMockMatchers(options.contracts, options.only)

  return createServer(async (req, res) => {
    const started = Date.now()
    try {
      // CORS preflight / generic OPTIONS.
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders())
        res.end()
        return
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const method = (req.method ?? 'GET').toUpperCase() as HttpMethod
      // Prefer a full method+path match; fall back to path-only (for 405).
      const pathMatch = matchers.find(matcher => matcher.method === method && matcher.regex.test(url.pathname))
        ?? matchers.find(matcher => matcher.regex.test(url.pathname))

      // Meta endpoint: list available mock routes.
      if (url.pathname === '/__mock/contracts' || url.pathname === '/__mock/contracts/') {
        send(res, 200, {
          contracts: matchers.map(({ contract }) => ({
            method: contract.method,
            path: contract.path,
            name: contract.name ?? null,
            tags: contract.tags ?? [],
          })),
        })
        return
      }

      if (!pathMatch) {
        send(res, 404, { error: { code: BUILT_IN_ERROR_CODES.notFound, message: `No mock for ${method} ${url.pathname}` } })
        return
      }

      if (pathMatch.method !== method) {
        send(res, 405, { error: { code: BUILT_IN_ERROR_CODES.methodNotAllowed, message: `${pathMatch.method} ${pathMatch.contract.path} does not accept ${method}` } })
        return
      }

      const match = pathMatch

      const contract = match.contract
      const params: Record<string, string> = {}
      const exec = match.regex.exec(url.pathname)
      for (const name of match.names) {
        params[name] = decodeURIComponent(exec?.groups?.[name] ?? '')
      }

      const query: Record<string, string | string[]> = {}
      for (const [key, value] of url.searchParams.entries()) {
        // Mirror h3/ufo semantics: repeated keys arrive as arrays.
        const existing = query[key]
        if (existing === undefined) {
          query[key] = value
        } else if (Array.isArray(existing)) {
          existing.push(value)
        } else {
          query[key] = [existing, value]
        }
      }

      let body: unknown
      let bodyError: ApiError | undefined
      if (method !== 'GET' && method !== 'HEAD') {
        const parsed = await readJsonBody(req)
        if (!parsed.ok) {
          bodyError = new ApiError({ code: BUILT_IN_ERROR_CODES.validation, message: 'Request body must be valid JSON', statusCode: 400 })
        }
        body = parsed.value
      }

      if (options.delay) await sleep(options.delay)

      // Lenient mode: skip request validation entirely.
      if (!options.lenient) {
        try {
          if (bodyError) throw bodyError
          if (contract.params) validateContractInput(contract, 'params', contract.params, params)
          if (contract.query) validateContractInput(contract, 'query', contract.query, query)
          if (method !== 'GET' && method !== 'HEAD' && contract.body) {
            validateContractInput(contract, 'body', contract.body, body)
          }
        } catch (error) {
          const apiError = error instanceof ApiError ? error : new ApiError({ code: BUILT_IN_ERROR_CODES.internal, message: String(error) })
          send(res, apiError.statusCode, errorPayload(apiError))
          return
        }
      }

      let response: unknown
      try {
        response = generateMockResponse(contract, { seed: options.seed })
        if (contract.response) {
          validateContractResponse(contract, contract.response as ZodType, response)
        }
      } catch (error) {
        send(res, 500, { error: { code: BUILT_IN_ERROR_CODES.internal, message: error instanceof Error ? error.message : String(error) } })
        return
      }

      send(res, 200, response, { 'x-mock-time': String(Date.now() - started) })
    } catch (error) {
      send(res, 500, { error: { code: BUILT_IN_ERROR_CODES.internal, message: error instanceof Error ? error.message : String(error) } })
    }
  })
}

/** Creates the mock server and starts listening. Resolves once ready. */
export function startMockServer(options: MockServerOptions): Promise<MockServerHandle> {
  const server = createMockServer(options)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 4000, options.host ?? '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : options.port ?? 4000
      const host = options.host ?? '127.0.0.1'
      resolve({
        server,
        port,
        host,
        url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
        close: () => new Promise((resolveClose, rejectClose) => {
          server.close(error => (error ? rejectClose(error) : resolveClose()))
        }),
      })
    })
  })
}

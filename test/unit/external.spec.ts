import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { z } from 'zod'
import { defineApiContract, ApiError } from '../../src/client'
import type { ContractFromDefinition } from '../../src/runtime/shared/types'
import { isExternalContract, resolveContractUrl } from '../../src/runtime/shared/contract'
import { executeContractRequest, type ContractFetch } from '../../src/client/transport'
import { generateOpenApiDocument } from '../../src/openapi/generator'
import { buildMockMatchers } from '../../src/mock/server'

const GitHubUser = defineApiContract({
  name: 'GitHubUser',
  method: 'GET',
  path: 'https://api.github.com/users/:username',
  params: z.object({ username: z.string() }),
  response: z.object({ login: z.string(), id: z.number() }),
})

const StripeCharge = defineApiContract({
  name: 'StripeCharge',
  method: 'POST',
  path: '/v1/charges/:id',
  baseUrl: 'https://api.stripe.com',
  params: z.object({ id: z.string() }),
  response: z.object({ status: z.string() }),
})

const Internal = defineApiContract({
  method: 'GET',
  path: '/api/users/:id',
  params: z.object({ id: z.string() }),
})

describe('isExternalContract', () => {
  it('detects absolute URLs and baseUrl', () => {
    expect(isExternalContract(GitHubUser)).toBe(true)
    expect(isExternalContract(StripeCharge)).toBe(true)
    expect(isExternalContract(Internal)).toBe(false)
  })
})

describe('resolveContractUrl', () => {
  it('keeps internal paths relative', () => {
    expect(resolveContractUrl(Internal, { id: '42' })).toBe('/api/users/42')
  })

  it('resolves absolute URL paths with params', () => {
    expect(resolveContractUrl(GitHubUser, { username: 'nuxt' })).toBe('https://api.github.com/users/nuxt')
  })

  it('joins baseUrl with the path (strip trailing slashes)', () => {
    expect(resolveContractUrl(StripeCharge, { id: 'ch_1' })).toBe('https://api.stripe.com/v1/charges/ch_1')
  })

  it('encodes path parameters', () => {
    expect(resolveContractUrl(GitHubUser, { username: 'a b' })).toBe('https://api.github.com/users/a%20b')
  })

  it('throws when a path parameter is missing', () => {
    expect(() => resolveContractUrl(GitHubUser, {})).toThrow(/Missing path parameter/)
  })
})

describe('external contract transport (e2e)', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += String(chunk) })
      req.on('end', () => {
        if (req.url?.startsWith('/users/')) {
          const login = decodeURIComponent(req.url.slice('/users/'.length))
          if (login === 'missing') {
            res.writeHead(404, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } }))
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ login, id: 1 }))
          return
        }
        if (req.url === '/charges' && req.method === 'POST') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ status: 'created', receivedBody: JSON.parse(body || 'null') }))
          return
        }
        res.writeHead(404)
        res.end()
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

    LocalGitHub = defineApiContract({
      name: 'LocalGitHubUser',
      method: 'GET',
      path: '/users/:username',
      baseUrl,
      params: z.object({ username: z.string() }),
      response: z.object({ login: z.string(), id: z.number() }),
    })
    CreateCharge = defineApiContract({
      name: 'CreateCharge',
      method: 'POST',
      path: '/charges',
      baseUrl,
      body: z.object({ amount: z.number() }),
      response: z.object({ status: z.string(), receivedBody: z.object({ amount: z.number() }).optional() }),
    })
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  /** Pluggable transport adapter: plain fetch + query serialization. */
  function makeFetch(): ContractFetch {
    return (url, init) => {
      const record = init as { method?: string, query?: Record<string, unknown>, body?: unknown, headers?: Record<string, string> }
      const target = new URL(url)
      for (const [key, value] of Object.entries(record.query ?? {})) {
        if (value !== undefined && value !== null) target.searchParams.set(key, String(value))
      }
      return fetch(target, {
        method: record.method,
        headers: record.headers,
        body: record.body === undefined ? undefined : JSON.stringify(record.body),
      }).then(async (response) => {
        const payload = await response.json()
        if (!response.ok) {
          const error = new Error((payload as { error?: { message?: string } }).error?.message ?? 'Request failed')
          const enrichable = error as { data?: unknown, statusCode?: number }
          enrichable.data = payload
          enrichable.statusCode = response.status
          throw error
        }
        return payload
      })
    }
  }

  let LocalGitHub: ContractFromDefinition<{
    name: 'LocalGitHubUser'
    method: 'GET'
    path: '/users/:username'
    baseUrl: string
    params: z.ZodObject<{ username: z.ZodString }>
    response: z.ZodObject<{ login: z.ZodString, id: z.ZodNumber }>
  }>
  let CreateCharge: ContractFromDefinition<{
    name: 'CreateCharge'
    method: 'POST'
    path: '/charges'
    baseUrl: string
    body: z.ZodObject<{ amount: z.ZodNumber }>
    response: z.ZodObject<{ status: z.ZodString, receivedBody: z.ZodOptional<z.ZodObject<{ amount: z.ZodNumber }>> }>
  }>

  it('sends requests over the pluggable transport', async () => {
    const data = await executeContractRequest(LocalGitHub, { params: { username: 'nuxt' } }, makeFetch())
    expect((data as { login: string, id: number }).login).toBe('nuxt')
    expect((data as { login: string, id: number }).id).toBe(1)
  })

  it('serializes body for external POST', async () => {
    const data = await executeContractRequest(CreateCharge, { body: { amount: 100 } }, makeFetch()) as { status: string, receivedBody?: { amount: number } }
    expect(data.status).toBe('created')
    expect(data.receivedBody?.amount).toBe(100)
  })

  it('surfaces external API errors as ApiError', async () => {
    await expect(
      executeContractRequest(LocalGitHub, { params: { username: 'missing' } }, makeFetch()),
    ).rejects.toSatisfy((error: unknown) => error instanceof ApiError && error.code === 'USER_NOT_FOUND' && error.statusCode === 404)
  })
})

describe('tooling guards', () => {
  it('skips external contracts from OpenAPI with a warning', () => {
    const { document, warnings } = generateOpenApiDocument([GitHubUser, Internal])
    expect(Object.keys(document.paths as object)).toEqual(['/api/users/{id}'])
    expect(warnings.some(warning => warning.message.includes('External contract'))).toBe(true)
  })

  it('skips external contracts from the mock server', () => {
    const matchers = buildMockMatchers([GitHubUser, Internal])
    expect(matchers).toHaveLength(1)
    expect(matchers[0]?.contract.path).toBe('/api/users/:id')
  })
})
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineApiContract } from '../../src/client'
import { startMockServer, type MockServerHandle } from '../../src/mock/server'

const User = defineApiContract({
  name: 'MockUser',
  method: 'GET',
  path: '/api/users/:id',
  params: z.object({ id: z.string().min(1) }),
  response: z.object({ id: z.string(), name: z.string(), email: z.string().email() }),
  errors: { USER_NOT_FOUND: z.object({ code: z.literal('USER_NOT_FOUND') }) },
})

const List = defineApiContract({
  method: 'GET',
  path: '/api/users',
  query: z.object({ page: z.coerce.number().int().positive().default(1) }),
  response: z.object({ users: z.array(z.object({ id: z.string() })), total: z.number().int() }),
})

const Create = defineApiContract({
  method: 'POST',
  path: '/api/users',
  body: z.object({ name: z.string().min(1), email: z.string().email() }),
  response: z.object({ id: z.string(), name: z.string(), email: z.string() }),
})

const Tags = defineApiContract({
  method: 'GET',
  path: '/api/tags',
  query: z.object({ tag: z.array(z.string().min(1)).min(2) }),
  response: z.object({ tags: z.array(z.string()) }),
})

let handle: MockServerHandle

beforeAll(async () => {
  handle = await startMockServer({ contracts: [User, List, Create, Tags], port: 0, seed: 42 })
})

afterAll(async () => {
  await handle.close()
})

describe('standalone mock server', () => {
  it('serves schema-valid generated responses', async () => {
    const response = await fetch(`${handle.url}/api/users/u-1`)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-mock-server')).toBe('nuxt-api-contract')
    const body = (await response.json()) as { id: string, name: string, email: string }
    expect(User.response!.safeParse(body).success).toBe(true)
  })

  it('is deterministic per contract', async () => {
    const a = await (await fetch(`${handle.url}/api/users/u-1`)).json()
    const b = await (await fetch(`${handle.url}/api/users/u-2`)).json()
    expect(a).toEqual(b)
  })

  it('rejects invalid requests like the real server', async () => {
    const response = await fetch(`${handle.url}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'nope' }),
    })
    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error?: { code?: string } }
    expect(payload.error?.code).toBe('VALIDATION_ERROR')
  })

  it('lenient mode skips request validation', async () => {
    const lenient = await startMockServer({ contracts: [Create], port: 0, seed: 42, lenient: true })
    try {
      const response = await fetch(`${lenient.url}/api/users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { name: string, email: string }
      expect(Create.response!.safeParse(body).success).toBe(true)
    } finally {
      await lenient.close()
    }
  })

  it('handles 404 and 405', async () => {
    expect((await fetch(`${handle.url}/api/unknown`)).status).toBe(404)
    expect((await fetch(`${handle.url}/api/users/1`, { method: 'DELETE' })).status).toBe(405)
  })

  it('answers CORS preflight', async () => {
    const response = await fetch(`${handle.url}/api/users/1`, { method: 'OPTIONS' })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('aggregates repeated query params into arrays like h3/ufo does', async () => {
    // Repeated keys must arrive as an array so `.array().min(2)` validates.
    const response = await fetch(`${handle.url}/api/tags?tag=a&tag=b`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { tags: string[] }
    expect(Tags.response!.safeParse(body).success).toBe(true)

    // A single occurrence stays a plain string, so a `.min(2)` array schema rejects it.
    const single = await fetch(`${handle.url}/api/tags?tag=a`)
    expect(single.status).toBe(400)
    const payload = (await single.json()) as { error?: { code?: string } }
    expect(payload.error?.code).toBe('VALIDATION_ERROR')
  })

  it('lists available mock endpoints', async () => {
    const response = await fetch(`${handle.url}/__mock/contracts`)
    const body = (await response.json()) as { contracts: Array<{ path: string }> }
    expect(body.contracts.map(c => c.path)).toContain('/api/users/:id')
  })
})

import { describe, expect, it } from 'vitest'
import { ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { createEvent, defineEventHandler } from 'h3'
import { z } from 'zod'
import { defineApiContract } from '../../src/runtime/shared/contract'
import { defineContractHandler } from '../../src/server/defineContractHandler'
import { defineVersionedHandlers, resolveRequestedApiVersion } from '../../src/server/versioning'

/** Creates an h3 event from a URL + headers without starting a server. */
function createTestEvent(url: string, headers: Record<string, string> = {}, params: Record<string, string> = {}) {
  const req = new EventEmitter() as unknown as IncomingMessage
  req.url = url
  req.headers = { ...headers }
  req.method = 'GET'
  const res = new ServerResponse(req)
  const event = createEvent(req, res)
  event.context.params = params
  return event
}

const GetUserV1 = defineApiContract({
  name: 'VersionedGetUser',
  version: 1,
  method: 'GET',
  path: '/api/v1/users/:id',
  params: z.object({ id: z.string() }),
  response: z.object({ id: z.string(), generation: z.literal(1) }),
  deprecated: { since: 2, sunset: '2027-01-01', message: 'Use v2' },
})

const GetUserV2 = defineApiContract({
  name: 'VersionedGetUser',
  version: 2,
  method: 'GET',
  path: '/api/v2/users/:id',
  params: z.object({ id: z.string() }),
  response: z.object({ id: z.string(), generation: z.literal(2) }),
})

describe('resolveRequestedApiVersion', () => {
  it('reads the x-api-version header', () => {
    const event = createTestEvent('/api/users/1', { 'x-api-version': '2' })
    expect(resolveRequestedApiVersion(event)).toBe(2)
  })

  it('reads the ?v= query parameter', () => {
    const event = createTestEvent('/api/users/1?v=3')
    expect(resolveRequestedApiVersion(event)).toBe(3)
  })

  it('prefers the header over the query', () => {
    const event = createTestEvent('/api/users/1?v=3', { 'x-api-version': '1' })
    expect(resolveRequestedApiVersion(event)).toBe(1)
  })

  it('returns undefined for absent or invalid values', () => {
    expect(resolveRequestedApiVersion(createTestEvent('/api/users/1'))).toBeUndefined()
    expect(resolveRequestedApiVersion(createTestEvent('/api/users/1?v=abc'))).toBeUndefined()
    expect(resolveRequestedApiVersion(createTestEvent('/api/users/1?v=0'))).toBeUndefined()
    expect(resolveRequestedApiVersion(createTestEvent('/api/users/1', { 'x-api-version': 'nan' }))).toBeUndefined()
  })

  it('rejects values that only start with a number (strict parsing)', () => {
    expect(resolveRequestedApiVersion(createTestEvent('/api/users/1', { 'x-api-version': '2abc' }))).toBeUndefined()
    expect(resolveRequestedApiVersion(createTestEvent('/api/users/1?v=2abc'))).toBeUndefined()
    expect(resolveRequestedApiVersion(createTestEvent('/api/users/1?v=1.5'))).toBeUndefined()
  })
})

describe('defineVersionedHandlers', () => {
  const handlerV1 = defineContractHandler(GetUserV1, async ({ params }) => ({ id: params.id, generation: 1 as const }))
  const handlerV2 = defineContractHandler(GetUserV2, async ({ params }) => ({ id: params.id, generation: 2 as const }))

  const negotiation = defineVersionedHandlers([
    { version: 1, handler: handlerV1, deprecated: { since: 2, sunset: '2027-01-01', message: 'Use v2' } },
    { version: 2, handler: handlerV2 },
  ], { defaultVersion: 2 })

  it('serves the default (highest) version when no version requested', async () => {
    const event = createTestEvent('/api/v2/users/u1', {}, { id: 'u1' })
    const result = await negotiation(event) as { generation: number }
    expect(result.generation).toBe(2)
  })

  it('serves the requested version by header', async () => {
    const event = createTestEvent('/api/v1/users/u1', { 'x-api-version': '1' }, { id: 'u1' })
    const result = await negotiation(event) as { generation: number }
    expect(result.generation).toBe(1)
    expect(event.node.res.getHeader('Deprecation')).toBe('@2')
    expect(event.node.res.getHeader('Sunset')).toBe('2027-01-01')
    expect(event.node.res.getHeader('Warning')).toBe('299 - "Use v2"')
  })

  it('serves the requested version by query', async () => {
    const event = createTestEvent('/api/v2/users/u1?v=1', {}, { id: 'u1' })
    const result = await negotiation(event) as { generation: number }
    expect(result.generation).toBe(1)
  })

  it('falls back to the closest lower version', async () => {
    const event = createTestEvent('/api/v2/users/u1?v=5', {}, { id: 'u1' })
    const result = await negotiation(event) as { generation: number }
    expect(result.generation).toBe(2)
  })

  it('responds with VERSION_NOT_FOUND for unknown versions when fallback is disabled', async () => {
    const strict = defineVersionedHandlers([
      { version: 1, handler: handlerV1 },
      { version: 2, handler: handlerV2 },
    ], { fallback: false })

    const event = createTestEvent('/api/v2/users/u1?v=9')
    const result = await strict(event) as { error?: { code?: string } }
    expect(result.error?.code).toBe('VERSION_NOT_FOUND')
  })

  it('throws when no versions are provided', () => {
    expect(() => defineVersionedHandlers([])).toThrow(/at least one version/)
  })

  it('throws when defaultVersion has no handler', () => {
    expect(() => defineVersionedHandlers([
      { version: 1, handler: handlerV1 },
    ], { defaultVersion: 3 })).toThrow(/defaultVersion/)
  })

  it('attaches deprecation headers on the deprecated entry only', async () => {
    const event = createTestEvent('/api/v2/users/u1?v=2')
    await negotiation(event)
    expect(event.node.res.getHeader('Deprecation')).toBeUndefined()
  })

  it('works with plain event handlers as entries', async () => {
    const plain = defineVersionedHandlers([
      { version: 1, handler: defineEventHandler(() => ({ ok: true })) },
    ], { defaultVersion: 1 })
    const event = createTestEvent('/api/anything')
    expect(await plain(event)).toEqual({ ok: true })
  })
})

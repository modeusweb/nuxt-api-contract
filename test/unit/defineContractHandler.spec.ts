import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { ServerResponse } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { createEvent } from 'h3'
import { z } from 'zod'
import { defineApiContract, mockContract, clearContractRegistry } from '../../src/client'
import { defineContractHandler } from '../../src/server/defineContractHandler'

/** Creates an h3 event from a URL without starting a server. */
function createTestEvent(url: string, params: Record<string, string> = {}) {
  const req = new EventEmitter() as unknown as IncomingMessage
  req.url = url
  req.headers = {}
  req.method = 'GET'
  const res = new ServerResponse(req)
  const event = createEvent(req, res)
  event.context.params = params
  return event
}

const Plain = defineApiContract({
  name: 'HandlerPlain',
  method: 'GET',
  path: '/api/handler-plain/:id',
  params: z.object({ id: z.string() }),
  response: z.object({ id: z.string() }),
})

const Deprecated = defineApiContract({
  name: 'HandlerDeprecated',
  version: 1,
  method: 'GET',
  path: '/api/handler-deprecated/:id',
  params: z.object({ id: z.string() }),
  response: z.object({ id: z.string(), mocked: z.boolean() }),
  deprecated: { since: 2, sunset: '2027-01-01', message: 'Use v2' },
})

/** Injects runtime config into the fake event (read by `useNitroRuntimeConfig`). */
function withRuntimeConfig(event: ReturnType<typeof createTestEvent>, apiContract: Record<string, unknown>) {
  event.context.$config = { apiContract }
  return event
}

describe('defineContractHandler', () => {
  it('attaches deprecation headers to successful responses', async () => {
    const handler = defineContractHandler(Deprecated, async ({ params }) => ({ id: params.id, mocked: false }))
    const event = createTestEvent('/api/handler-deprecated/1', { id: '1' })
    const result = await handler(event) as { id: string }
    expect(result.id).toBe('1')
    expect(event.node.res.getHeader('Deprecation')).toBe('@2')
    expect(event.node.res.getHeader('Sunset')).toBe('2027-01-01')
  })

  it('attaches deprecation headers to ApiError responses', async () => {
    const handler = defineContractHandler(Deprecated, async () => {
      const { createApiError } = await import('../../src/client')
      throw createApiError('USER_NOT_FOUND', 'Nope', 404)
    })
    const event = createTestEvent('/api/handler-deprecated/missing', { id: 'missing' })
    const result = await handler(event) as { error: { code: string } }
    expect(result.error.code).toBe('USER_NOT_FOUND')
    expect(event.node.res.getHeader('Deprecation')).toBe('@2')
  })

  it('attaches deprecation headers to mocked responses and honors mock.delay', async () => {
    mockContract(Deprecated, { response: () => ({ id: 'm1', mocked: true }), delay: 30 })
    try {
      const handler = defineContractHandler(Deprecated, async ({ params }) => ({ id: params.id, mocked: false }))
      const event = withRuntimeConfig(
        createTestEvent('/api/handler-deprecated/m1', { id: 'm1' }),
        { mocks: true, validateResponse: 'never' },
      )
      const started = Date.now()
      const result = await handler(event) as { id: string, mocked: boolean }
      const elapsed = Date.now() - started
      expect(result).toEqual({ id: 'm1', mocked: true })
      expect(elapsed).toBeGreaterThanOrEqual(25)
      expect(event.node.res.getHeader('Deprecation')).toBe('@2')
    } finally {
      clearContractRegistry()
    }
  })

  it('logs unexpected non-ApiError failures and returns INTERNAL_ERROR', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const handler = defineContractHandler(Plain, async () => {
        throw new TypeError('boom')
      })
      const event = createTestEvent('/api/handler-plain/1', { id: '1' })
      const result = await handler(event) as { error: { code: string, message: string } }
      expect(result.error.code).toBe('INTERNAL_ERROR')
      expect(result.error.message).toBe('Internal server error')
      expect(event.node.res.statusCode).toBe(500)
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain('GET /api/handler-plain/:id')
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('does not log expected ApiError responses', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const handler = defineContractHandler(Plain, async () => {
        const { createApiError } = await import('../../src/client')
        throw createApiError('USER_NOT_FOUND', 'Nope', 404)
      })
      const event = createTestEvent('/api/handler-plain/missing', { id: 'missing' })
      const result = await handler(event) as { error: { code: string } }
      expect(result.error.code).toBe('USER_NOT_FOUND')
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})
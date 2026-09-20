import { describe, expect, it } from 'vitest'
import { ApiError, createApiError, isApiError, parseApiErrorPayload, serializeApiError, toApiError } from '../../src/client'

describe('createApiError', () => {
  it('creates an error from positional arguments', () => {
    const error = createApiError('USER_NOT_FOUND', 'User not found', 404)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('USER_NOT_FOUND')
    expect(error.message).toBe('User not found')
    expect(error.statusCode).toBe(404)
  })

  it('creates an error from an options object', () => {
    const error = createApiError({ code: 'VALIDATION_ERROR', statusCode: 400, message: 'Invalid', details: { a: 1 } })
    expect(error.statusCode).toBe(400)
    expect(error.details).toEqual({ a: 1 })
  })

  it('defaults the status code to 500', () => {
    expect(createApiError('X').statusCode).toBe(500)
  })
})

describe('serialization round-trip', () => {
  it('round-trips through the payload format', () => {
    const error = createApiError({ code: 'NOT_FOUND', message: 'Nope', statusCode: 404 })
    const payload = serializeApiError(error)
    expect(payload).toEqual({ error: { code: 'NOT_FOUND', message: 'Nope', statusCode: 404, details: undefined, issues: undefined } })
    const restored = parseApiErrorPayload(payload)
    expect(restored?.code).toBe('NOT_FOUND')
    expect(restored?.statusCode).toBe(404)
  })

  it('rejects malformed payloads', () => {
    expect(parseApiErrorPayload('nope')).toBeUndefined()
    expect(parseApiErrorPayload({ error: { foo: 1 } })).toBeUndefined()
  })
})

describe('isApiError / toApiError', () => {
  it('recognizes ApiError instances', () => {
    expect(isApiError(createApiError('X'))).toBe(true)
    expect(isApiError(new Error('x'))).toBe(false)
    expect(isApiError(null)).toBe(false)
  })

  it('wraps unknown errors', () => {
    const wrapped = toApiError(new Error('boom'))
    expect(wrapped.code).toBe('INTERNAL_ERROR')
    expect(wrapped.message).toBe('boom')
  })
})

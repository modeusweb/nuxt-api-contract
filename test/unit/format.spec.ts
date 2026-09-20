import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { formatValidationMessage, sanitizeIssues, toValidationIssues } from '../../src/client'

const schema = z.object({ limit: z.number(), name: z.string() })

describe('toValidationIssues', () => {
  it('maps zod issues into sanitized issues', () => {
    const result = schema.safeParse({ limit: 'nope' })
    expect(result.success).toBe(false)
    const issues = toValidationIssues((result as { error: z.ZodError }).error)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]!.path).toContain('limit')
    expect(issues[0]!.message).toBeTruthy()
  })
})

describe('formatValidationMessage', () => {
  it('builds a friendly multi-line message', () => {
    const message = formatValidationMessage({
      subject: 'query',
      method: 'GET',
      path: '/api/users',
      issues: [{ path: 'query.limit', message: 'Expected number', expected: 'number', received: 'string' }],
    })
    expect(message).toContain('[nuxt-api-contract]')
    expect(message).toContain('Invalid query for GET /api/users')
    expect(message).toContain('query.limit:')
    expect(message).toContain('Received string')
  })

  it('can omit received values', () => {
    const message = formatValidationMessage({
      subject: 'response',
      method: 'GET',
      path: '/api/users/:id',
      issues: [{ path: 'response.id', message: 'Invalid type', expected: 'string' }],
      includeReceived: false,
    })
    expect(message).not.toContain('Received')
  })
})

describe('sanitizeIssues', () => {
  it('strips received values', () => {
    const issues = sanitizeIssues([{ path: 'body.password', message: 'bad', received: 'secret' }])
    expect(issues[0]!.received).toBeUndefined()
    expect(issues[0]!.message).toBe('bad')
  })
})

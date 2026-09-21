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

  it('exposes machine-readable issue codes (Zod 3 and Zod 4)', () => {
    const result = schema.safeParse({ limit: 'nope', name: 1 })
    const issues = toValidationIssues((result as { error: z.ZodError }).error)
    expect(issues.length).toBe(2)
    for (const issue of issues) {
      expect(typeof issue.code).toBe('string')
      expect(issue.code!.length).toBeGreaterThan(0)
    }
    // A surviving expectation is reported in the structured form.
    expect(issues.find(issue => issue.path === 'limit')).toBeDefined()
  })
})

describe('formatValidationMessage', () => {
  it('prefixes the subject exactly once', () => {
    const message = formatValidationMessage({
      subject: 'query',
      method: 'GET',
      path: '/api/users',
      issues: [
        { path: 'limit', message: 'Invalid input', expected: 'number' },
        { path: 'query.limit', message: 'Invalid input', expected: 'number' },
        { path: '(root)', message: 'Invalid input', expected: 'object' },
      ],
    })
    expect(message).toContain('\nquery.limit:')
    expect(message).not.toContain('query.query.limit')
    expect(message).toContain('\nquery:')
  })

  it('prints the Zod 4 message verbatim when there is no structured expectation', () => {
    const message = formatValidationMessage({
      subject: 'body',
      method: 'POST',
      path: '/api/users',
      issues: [{ path: 'width', message: 'Too small: expected number to be >0', code: 'too_small' }],
    })
    expect(message).toContain('body.width:')
    expect(message).toContain('Too small: expected number to be >0')
    expect(message).not.toContain('Expected Too small')
  })

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

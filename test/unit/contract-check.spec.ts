import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { checkContracts } from '../../src/contract-check'
import { defineApiContract } from '../../src/client'

describe('checkContracts', () => {
  it('accepts a consistent named contract', () => {
    const contract = defineApiContract({
      name: 'GetUser',
      method: 'GET',
      path: '/api/users/:id',
      params: z.object({ id: z.string() }),
      response: z.object({ id: z.string() }),
    })

    expect(checkContracts([contract])).toMatchObject({ errors: 0, warnings: 0 })
  })

  it('reports missing path parameters and duplicate routes', () => {
    const first = defineApiContract({ name: 'First', method: 'GET', path: '/api/users/:id' })
    const second = defineApiContract({ name: 'Second', method: 'GET', path: '/api/users/:id' })

    const result = checkContracts([first, second])
    expect(result.errors).toBe(1)
    expect(result.issues.some(issue => issue.message.includes('Duplicate route'))).toBe(true)
    expect(result.issues.some(issue => issue.message.includes('no object params schema'))).toBe(true)
  })

  it('warns for deprecated contracts with migration guidance', () => {
    const deprecated = defineApiContract({ name: 'Old', method: 'GET', path: '/api/old', deprecated: { sunset: '2027-01-01' } })
    const result = checkContracts([deprecated])
    expect(result.errors).toBe(0)
    expect(result.issues.some(issue => issue.message.includes('migrate consumers'))).toBe(true)
  })

  it('warns for anonymous contracts and extra params', () => {
    const result = checkContracts([
      defineApiContract({
        method: 'GET',
        path: '/api/health',
        params: z.object({ unused: z.string() }),
      }),
    ])

    expect(result.errors).toBe(0)
    expect(result.warnings).toBe(2)
  })
})

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineApiContract, ApiError  } from '../../src/client'
import { validateContractInput, validateContractResponse, shouldValidateResponse } from '../../src/server/validation'


const contract = defineApiContract({
  name: 'SearchUsers',
  method: 'GET',
  path: '/api/users',
  query: z.object({ limit: z.coerce.number().int().max(100).default(20) }),
  response: z.object({ users: z.array(z.object({ id: z.string() })) }),
})

describe('validateContractInput', () => {
  it('returns parsed (coerced, defaulted) values', () => {
    const parsed = validateContractInput(contract, 'query', contract.query!, { limit: '5' })
    expect((parsed as { limit: number }).limit).toBe(5)
  })

  it('throws VALIDATION_ERROR with a friendly message', () => {
    try {
      validateContractInput(contract, 'query', contract.query!, { limit: 'abc' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      const apiError = error as ApiError
      expect(apiError.code).toBe('VALIDATION_ERROR')
      expect(apiError.statusCode).toBe(400)
      expect(apiError.message).toContain('[nuxt-api-contract]')
      expect(apiError.message).toContain('Invalid query for GET /api/users')
      expect(apiError.message).toContain('query.limit')
    }
  })
})

describe('validateContractResponse', () => {
  it('passes valid responses through', () => {
    const validated = validateContractResponse(contract, contract.response!, { users: [{ id: '1' }] })
    expect(validated.users[0]!.id).toBe('1')
  })

  it('throws the dedicated response validation code', () => {
    try {
      validateContractResponse(contract, contract.response!, { users: [{ id: 123 }] })
      expect.unreachable('should have thrown')
    } catch (error) {
      const apiError = error as ApiError
      expect(apiError.code).toBe('API_CONTRACT_RESPONSE_VALIDATION_ERROR')
      expect(apiError.statusCode).toBe(500)
      expect(apiError.message).toContain('Invalid response for GET /api/users')
    }
  })
})

describe('shouldValidateResponse', () => {
  it('respects the modes', () => {
    expect(shouldValidateResponse('always')).toBe(true)
    expect(shouldValidateResponse('never')).toBe(false)
    // 'development' depends on NODE_ENV; assert it is boolean.
    expect(typeof shouldValidateResponse('development')).toBe('boolean')
  })
})

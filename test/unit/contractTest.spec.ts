import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineApiContract, createApiError } from '../../src/client'
import { defineContractHandler } from '../../src/server'
import { testContract, ContractAssertionError } from '../../src/testing/contractTest'
import {
  startContractCoverage,
  stopContractCoverage,
  getContractCoverage,
  formatContractCoverage,
  assertContractCoverage,
} from '../../src/testing/coverage'

const GetUser = defineApiContract({
  name: 'TestGetUser',
  method: 'GET',
  path: '/api/test-users/:id',
  params: z.object({ id: z.string().min(1) }),
  response: z.object({ id: z.string(), name: z.string() }),
  errors: { USER_NOT_FOUND: z.object({ code: z.literal('USER_NOT_FOUND') }) },
})

const handler = defineContractHandler(GetUser, async ({ params }) => {
  if (params.id === 'missing') throw createApiError('USER_NOT_FOUND', 'User not found', 404)
  return { id: params.id, name: 'John' }
})

const suite = testContract(GetUser, handler)

describe('testContract', () => {
  it('expectSuccess returns typed data', async () => {
    const data = await suite.expectSuccess({ params: { id: 'u1' } })
    expect(data).toEqual({ id: 'u1', name: 'John' })
  })

  it('expectSuccess throws a ContractAssertionError on failure', async () => {
    await expect(suite.expectSuccess({ params: { id: 'missing' } })).rejects.toThrow(ContractAssertionError)
  })

  it('expectError validates code and status', async () => {
    const error = await suite.expectError({ params: { id: 'missing' } }, 'USER_NOT_FOUND', 404)
    expect(error.code).toBe('USER_NOT_FOUND')
    await expect(suite.expectError({ params: { id: 'missing' } }, 'OTHER_CODE')).rejects.toThrow(ContractAssertionError)
  })

  it('expectError throws when the call unexpectedly succeeds', async () => {
    await expect(suite.expectError({ params: { id: 'ok' } })).rejects.toThrow(ContractAssertionError)
  })

  it('expectValidationError checks issue paths', async () => {
    const error = await suite.expectValidationError({ params: { id: '' } }, ['id'])
    expect(error.statusCode).toBe(400)
    await expect(suite.expectValidationError({ params: { id: '' } }, ['nonexistent.path'])).rejects.toThrow(ContractAssertionError)
  })

  it('expectResponseValidationError catches bad handler output', async () => {
    const error = await suite.expectResponseValidationError({ params: { id: '1' } }, { id: 42, name: 'X' })
    expect(error.code).toBe('API_CONTRACT_RESPONSE_VALIDATION_ERROR')
    await expect(
      suite.expectResponseValidationError({ params: { id: '1' } }, () => ({ id: '1', name: 'Valid' })),
    ).rejects.toThrow(ContractAssertionError)
  })

  it('validateResponse validates raw values', () => {
    expect(() => suite.validateResponse({ id: '1', name: 'X' })).not.toThrow()
    expect(() => suite.validateResponse({ id: 42, name: 'X' })).toThrow(ContractAssertionError)
  })
})

describe('contract coverage', () => {
  afterEach(() => {
    stopContractCoverage()
  })

  it('tracks covered and uncovered contracts', async () => {
    startContractCoverage()
    await suite.expectSuccess({ params: { id: 'u1' } })

    const report = getContractCoverage()
    expect(report.coveredCount).toBe(1)
    expect(report.covered[0]!.calls).toBe(1)
    expect(report.covered[0]!.failures).toBe(0)
    expect(report.uncovered.some(entry => entry.name === 'TestUncovered')).toBe(true)
  })

  it('counts failures separately from calls', async () => {
    startContractCoverage()
    await suite.expectSuccess({ params: { id: 'u1' } }).catch(() => {})
    await suite.expectSuccess({ params: { id: 'missing' } }).catch(() => {})

    const entry = getContractCoverage().covered.find(entry => entry.name === 'TestGetUser')
    expect(entry?.calls).toBe(2)
    expect(entry?.failures).toBe(1)
  })

  it('validates a coverage threshold', () => {
    expect(assertContractCoverage({ total: 2, coveredCount: 2, percent: 100, covered: [], uncovered: [] }, 80)).toMatchObject({ passed: true, actual: 100 })
    expect(assertContractCoverage({ total: 2, coveredCount: 1, percent: 50, covered: [], uncovered: [] }, 80)).toMatchObject({ passed: false, actual: 50 })
    expect(() => assertContractCoverage({ total: 0, coveredCount: 0, percent: 100, covered: [], uncovered: [] }, 101)).toThrow(RangeError)
  })

  it('formats a report and respects stop/reset', async () => {
    startContractCoverage()
    await suite.expectSuccess({ params: { id: 'u1' } })
    const report = stopContractCoverage()
    const formatted = formatContractCoverage(report)
    expect(formatted).toContain('Contract coverage')
    expect(formatted).toContain('/api/test-users/:id')

    // After stop, calls are no longer recorded.
    await suite.expectSuccess({ params: { id: 'u1' } })
    expect(getContractCoverage().covered[0]!.calls).toBe(1)
  })
})

// Extra named contract so the uncovered list can be asserted against.
export const TestUncovered = defineApiContract({
  name: 'TestUncovered',
  method: 'DELETE',
  path: '/api/test-uncovered/:id',
  params: z.object({ id: z.string() }),
  response: z.object({ ok: z.boolean() }),
})

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  defineApiContract,
  getContractByName,
  isApiContract,
  listRegisteredContracts,
  mockContract,
  getContractMock,
  clearContractRegistry,
  serializeQuery,
  stableStringify,
} from '../../src/client'

const GetUser = defineApiContract({
  name: 'GetUser',
  method: 'GET',
  path: '/api/users/:id',
  params: z.object({ id: z.string() }),
  response: z.object({ id: z.string(), name: z.string() }),
})

describe('defineApiContract', () => {
  it('creates a contract with immutable metadata', () => {
    expect(isApiContract(GetUser)).toBe(true)
    expect(GetUser.kind).toBe('api-contract')
    expect(GetUser.method).toBe('GET')
    expect(GetUser.path).toBe('/api/users/:id')
    expect(() => {
      (GetUser as unknown as { method: string }).method = 'POST'
    }).toThrow()
  })

  it('registers named contracts in the registry', () => {
    expect(getContractByName('GetUser')).toBe(GetUser)
    expect(listRegisteredContracts().some(contract => contract.name === 'GetUser')).toBe(true)
  })

  it('returns undefined for unknown names', () => {
    expect(getContractByName('Missing')).toBeUndefined()
  })

  it('supports anonymous contracts', () => {
    const Anonymous = defineApiContract({ method: 'GET', path: '/api/x' })
    expect(Anonymous.name).toBeUndefined()
  })

  it('supports versioning metadata', () => {
    const Versioned = defineApiContract({ name: 'Versioned', version: 2, method: 'GET', path: '/api/v' })
    expect(Versioned.version).toBe(2)
    clearContractRegistry()
    expect(listRegisteredContracts()).toHaveLength(0)
  })

  it('re-registers silently but warns on genuine conflicts', () => {
    clearContractRegistry()
    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (message?: unknown) => { warnings.push(String(message)) }
    try {
      // Same name + same operation (dev HMR, build-time load then runtime).
      defineApiContract({ name: 'Reload', method: 'GET', path: '/api/reload', response: z.object({ ok: z.boolean() }) })
      defineApiContract({ name: 'Reload', method: 'GET', path: '/api/reload', response: z.object({ ok: z.boolean() }) })
      expect(warnings).toEqual([])

      // Same name + a different operation is a real conflict.
      defineApiContract({ name: 'Reload', method: 'POST', path: '/api/reload' })
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('Duplicate contract name "Reload"')
      // The latest definition wins.
      expect(getContractByName('Reload')?.method).toBe('POST')
    } finally {
      console.warn = originalWarn
      clearContractRegistry()
    }
  })
})

describe('mockContract', () => {
  it('stores and retrieves mocks', () => {
    mockContract(GetUser, { response: () => ({ id: '1', name: 'Mocked' }) })
    const mock = getContractMock(GetUser)
    expect(mock?.response?.()).toEqual({ id: '1', name: 'Mocked' })
  })
})

describe('query serialization', () => {
  it('serializes dates and bigints, drops undefined', () => {
    expect(serializeQuery({ a: new Date(0), b: 1n, c: undefined, d: 'x' })).toEqual({
      a: '1970-01-01T00:00:00.000Z',
      b: '1',
      d: 'x',
    })
  })

  it('produces stable keys regardless of property order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
  })
})

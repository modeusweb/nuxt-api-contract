import { describe, expect, it, beforeEach } from 'vitest'
import { z } from 'zod'
import { defineApiContract, clearContractRegistry } from '../../src/runtime/shared/contract'
import {
  versionedPath,
  hasVersionedPath,
  listContractVersions,
  getContractVersion,
  negotiateContractVersion,
  normalizeDeprecation,
  getDeprecationHeaders,
  isDeprecatedContract,
} from '../../src/runtime/shared/versioning'

describe('versionedPath', () => {
  it('prefixes the path with /api/vN', () => {
    expect(versionedPath(1, '/api/users/:id')).toBe('/api/v1/api/users/:id')
    expect(versionedPath(2, '/users/:id')).toBe('/api/v2/users/:id')
  })

  it('accepts paths without a leading slash', () => {
    expect(versionedPath(3, 'users')).toBe('/api/v3/users')
  })

  it('keeps path parameter inference working (type-level)', () => {
    const path = versionedPath(2, '/users/:id')
    // The return type is a template literal `/api/v2/users/:id`, so
    // `PathParams<typeof path>` still extracts `{ id: string }` (verified in
    // test/type/contract.test-d.ts).
    expect(path).toBe('/api/v2/users/:id')
  })

  it('throws on invalid versions at runtime', () => {
    expect(() => versionedPath(0, '/users')).toThrow()
    expect(() => versionedPath(1.5, '/users')).toThrow()
  })
})

describe('hasVersionedPath', () => {
  it('detects version segments', () => {
    expect(hasVersionedPath('/api/v1/users')).toBe(true)
    expect(hasVersionedPath('/v2/users')).toBe(true)
    expect(hasVersionedPath('/api/users')).toBe(false)
    expect(hasVersionedPath('/api/vendor/items')).toBe(false)
  })
})

describe('registry version helpers', () => {
  beforeEach(() => {
    clearContractRegistry()
  })

  it('lists versions sorted ascending', () => {
    defineApiContract({ name: 'GetUser', version: 2, method: 'GET', path: '/api/v2/users/:id' })
    defineApiContract({ name: 'GetUser', version: 1, method: 'GET', path: '/api/v1/users/:id' })
    defineApiContract({ name: 'Other', version: 1, method: 'GET', path: '/api/other' })

    const versions = listContractVersions('GetUser')
    expect(versions.map(contract => contract.version)).toEqual([1, 2])
  })

  it('getContractVersion picks exact and latest', () => {
    defineApiContract({ name: 'GetUser', version: 1, method: 'GET', path: '/api/v1/users/:id' })
    defineApiContract({ name: 'GetUser', version: 2, method: 'GET', path: '/api/v2/users/:id' })

    expect(getContractVersion('GetUser', 1)?.path).toBe('/api/v1/users/:id')
    expect(getContractVersion('GetUser')?.version).toBe(2)
    expect(getContractVersion('GetUser', 9)).toBeUndefined()
    expect(getContractVersion('Missing')).toBeUndefined()
  })

  it('negotiateContractVersion falls back to the closest lower version', () => {
    defineApiContract({ name: 'GetUser', version: 1, method: 'GET', path: '/api/v1/users/:id' })
    defineApiContract({ name: 'GetUser', version: 3, method: 'GET', path: '/api/v3/users/:id' })

    expect(negotiateContractVersion('GetUser', 3)?.version).toBe(3)
    expect(negotiateContractVersion('GetUser', 2)?.version).toBe(1)
    expect(negotiateContractVersion('GetUser', 0)?.version).toBe(1)
    expect(negotiateContractVersion('Missing', 1)).toBeUndefined()
  })
})

describe('deprecation', () => {
  it('normalizes the deprecated field', () => {
    expect(normalizeDeprecation(undefined)).toBeUndefined()
    expect(normalizeDeprecation(false)).toBeUndefined()
    expect(normalizeDeprecation(true)).toEqual({})
    expect(normalizeDeprecation({ sunset: '2027-01-01', message: 'Use v2' })).toEqual({
      sunset: '2027-01-01',
      message: 'Use v2',
    })
  })

  it('builds standard deprecation headers', () => {
    expect(getDeprecationHeaders({ deprecated: true })).toEqual({ Deprecation: 'true' })
    expect(getDeprecationHeaders({ deprecated: { since: 2 } })).toEqual({ Deprecation: '@2' })
    expect(getDeprecationHeaders({
      deprecated: { since: 1, sunset: '2027-06-01', message: 'Move to /v2' },
    })).toEqual({
      Deprecation: '@1',
      Sunset: '2027-06-01',
      Warning: '299 - "Move to /v2"',
    })
    expect(getDeprecationHeaders({ deprecated: false })).toEqual({})
  })

  it('isDeprecatedContract detects deprecated contracts', () => {
    expect(isDeprecatedContract({ deprecated: true })).toBe(true)
    expect(isDeprecatedContract({ deprecated: { sunset: '2027-01-01' } })).toBe(true)
    expect(isDeprecatedContract({ deprecated: undefined })).toBe(false)
    expect(isDeprecatedContract({ deprecated: false })).toBe(false)
  })

  it('contract definition accepts deprecated with schemas', () => {
    const contract = defineApiContract({
      name: 'GetUserOld',
      version: 1,
      method: 'GET',
      path: '/api/v1/users/:id',
      params: z.object({ id: z.string() }),
      response: z.object({ id: z.string() }),
      deprecated: { since: 2, sunset: '2027-01-01', message: 'Use v2' },
    })
    expect(contract.path).toBe('/api/v1/users/:id')
    expect(isDeprecatedContract(contract)).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import {
  serializeQuery,
  serializeQueryValue,
  stableStringify,
} from '../../src/client'

describe('serializeQueryValue', () => {
  it('passes primitives through', () => {
    expect(serializeQueryValue('john')).toBe('john')
    expect(serializeQueryValue(20)).toBe(20)
    expect(serializeQueryValue(false)).toBe(false)
  })

  it('serializes Date and bigint without inventing a protocol', () => {
    expect(serializeQueryValue(new Date('2024-01-01T00:00:00.000Z'))).toBe('2024-01-01T00:00:00.000Z')
    expect(serializeQueryValue(10n)).toBe('10')
  })

  it('serializes arrays element-wise and objects as JSON', () => {
    expect(serializeQueryValue(['a', 1, true])).toEqual(['a', 1, true])
    expect(serializeQueryValue([new Date('2024-01-01T00:00:00.000Z'), 2n])).toEqual(['2024-01-01T00:00:00.000Z', '2'])
    expect(serializeQueryValue({ a: 1 })).toBe('{"a":1}')
  })

  it('renders nullish values as empty strings', () => {
    expect(serializeQueryValue(undefined)).toBe('')
    expect(serializeQueryValue(null)).toBe('')
  })
})

describe('serializeQuery', () => {
  it('drops undefined entries and keeps the rest', () => {
    const query = serializeQuery({ page: 2, search: undefined, tags: ['a', 'b'], date: new Date('2024-05-06T00:00:00.000Z') })
    expect(query).toEqual({
      page: 2,
      tags: ['a', 'b'],
      date: '2024-05-06T00:00:00.000Z',
    })
    expect(Object.keys(query!)).not.toContain('search')
  })

  it('returns undefined when there is no query', () => {
    expect(serializeQuery(undefined)).toBeUndefined()
  })
})

describe('stableStringify', () => {
  it('is key-order independent so SSR and client keys match', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
  })

  it('sorts nested objects, normalizes Date/bigint and drops undefined', () => {
    const value = { z: { b: 2, a: undefined, c: new Date('2024-01-01T00:00:00.000Z') }, a: [3n, 1] }
    expect(stableStringify(value)).toBe('{"a":["3",1],"z":{"b":2,"c":"2024-01-01T00:00:00.000Z"}}')
  })

  it('handles arrays of objects deterministically', () => {
    expect(stableStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]')
  })
})

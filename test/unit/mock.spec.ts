import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineApiContract, autoMockContract, generateMockResponse, getContractMock } from '../../src/client'
import { validateContractResponse } from '../../src/server/validation'

const Address = z.object({ street: z.string(), city: z.string().min(2) })

const Profile = defineApiContract({
  name: 'MockProfile',
  method: 'GET',
  path: '/api/profiles/:id',
  response: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().min(1),
    age: z.number().int().min(18).max(99),
    active: z.boolean(),
    role: z.enum(['admin', 'user']),
    tags: z.array(z.string()),
    createdAt: z.date(),
    address: Address,
    note: z.string().optional(),
    nickname: z.string().nullable(),
  }),
})

describe('generateMockResponse', () => {
  it('is deterministic for a given seed', () => {
    const a = generateMockResponse(Profile, { seed: 42 })
    const b = generateMockResponse(Profile, { seed: 42 })
    expect(a).toEqual(b)
  })

  it('produces schema-valid data for rich contracts', () => {
    const mock = generateMockResponse(Profile, { seed: 42 })
    const result = (Profile.response as z.ZodType).safeParse(mock)
    expect(result.success).toBe(true)
    expect((mock as { tags: unknown[] }).tags.length).toBeGreaterThan(0)
    expect(String((mock as { email: string }).email)).toMatch(/@example\.com$/)
  })

  it('varies data between different contracts with the same seed', () => {
    const Other = defineApiContract({
      name: 'MockOther',
      method: 'GET',
      path: '/api/other',
      response: z.object({ id: z.string().uuid(), email: z.string().email() }),
    })
    const a = generateMockResponse(Profile, { seed: 42 }) as { id: string }
    const b = generateMockResponse(Other, { seed: 42 }) as { id: string }
    expect(a.id).not.toBe(b.id)
  })

  it('handles optional, nullable, union and default fields', () => {
    const Contract = defineApiContract({
      name: 'MockShapes',
      method: 'GET',
      path: '/api/shapes',
      response: z.object({
        opt: z.string().optional(),
        nil: z.string().nullable(),
        union: z.union([z.string(), z.number()]),
        shipping: z.discriminatedUnion('type', [
          z.object({ type: z.literal('pickup'), storeId: z.string() }),
          z.object({ type: z.literal('courier'), address: z.string() }),
        ]),
        limit: z.number().default(10),
      }),
    })
    const mock = generateMockResponse(Contract) as Record<string, unknown>
    const parsed = (Contract.response as z.ZodType).safeParse(mock)
    expect(parsed.success).toBe(true)
    expect(['pickup', 'courier']).toContain((mock.shipping as { type: string }).type)
    expect(mock.limit).toBe(10)
  })

  it('masks password/token fields', () => {
    const Contract = defineApiContract({
      name: 'MockSecrets',
      method: 'GET',
      path: '/api/secrets',
      response: z.object({ password: z.string(), token: z.string() }),
    })
    const mock = generateMockResponse(Contract) as Record<string, unknown>
    expect(mock.password).toBe('********')
    expect(mock.token).toBe('********')
  })
})

describe('autoMockContract', () => {
  it('registers a schema-valid generated mock', () => {
    autoMockContract(Profile, { seed: 7 })
    const mock = getContractMock(Profile)
    const generated = mock?.response?.()
    expect(generated).toBeDefined()
    expect(() => validateContractResponse(Profile, Profile.response as z.ZodType, generated)).not.toThrow()
  })
})

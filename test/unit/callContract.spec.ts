import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineApiContract, createApiError } from '../../src/client'
import { defineContractHandler } from '../../src/server'
import { callContract } from '../../src/testing'

const GetUser = defineApiContract({
  name: 'GetUser',
  method: 'GET',
  path: '/api/users/:id',
  params: z.object({ id: z.string().min(1) }),
  response: z.object({ id: z.string(), name: z.string() }),
  errors: { USER_NOT_FOUND: z.object({ code: z.literal('USER_NOT_FOUND') }) },
})

const handler = defineContractHandler(GetUser, async ({ params }) => {
  if (params.id === 'missing') {
    throw createApiError('USER_NOT_FOUND', 'User not found', 404)
  }
  return { id: params.id, name: 'John' }
})

describe('callContract', () => {
  it('runs the validation -> handler -> response-validation pipeline', async () => {
    const { data, error } = await callContract(GetUser, handler, { params: { id: 'u1' } })
    expect(error).toBeNull()
    expect(data).toEqual({ id: 'u1', name: 'John' })
  })

  it('returns validation errors for invalid input', async () => {
    const { error } = await callContract(GetUser, handler, { params: { id: '' } })
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('propagates typed ApiErrors from handlers', async () => {
    const { error } = await callContract(GetUser, handler, { params: { id: 'missing' } })
    expect(error?.code).toBe('USER_NOT_FOUND')
    expect(error?.statusCode).toBe(404)
  })

  it('detects invalid handler responses', async () => {
    // @ts-expect-error response id must be a string
    const badHandler = defineContractHandler(GetUser, async () => ({ id: 42, name: 'John' }))
    const { error } = await callContract(GetUser, badHandler, { params: { id: '1' } })
    expect(error?.code).toBe('API_CONTRACT_RESPONSE_VALIDATION_ERROR')
  })

  it('works with plain functions too', async () => {
    const plain = (async (ctx: { params: { id: string } }) => ({ id: ctx.params.id, name: 'X' })) as unknown as typeof handler
    const { data } = await callContract(GetUser, plain, { params: { id: 'u2' } })
    expect(data).toEqual({ id: 'u2', name: 'X' })
  })
})

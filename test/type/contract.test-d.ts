import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { useApi } from '../../src/client/useApi'
import { defineApiContract } from '../../src/client'
import { defineContractHandler } from '../../src/server'
import type { PathParams } from '../../src/shared'

const GetUser = defineApiContract({
  method: 'GET',
  path: '/api/users/:id',
  params: z.object({ id: z.string() }),
  response: z.object({ id: z.string(), name: z.string(), email: z.string().email() }),
})

const SearchUsers = defineApiContract({
  method: 'GET',
  path: '/api/users',
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().max(100).default(20),
    search: z.string().optional(),
  }),
  response: z.object({
    users: z.array(z.object({ id: z.string(), name: z.string() })),
    total: z.number(),
  }),
})

const CreateUser = defineApiContract({
  method: 'POST',
  path: '/api/users',
  body: z.object({ name: z.string().min(1), email: z.string().email() }),
  response: z.object({ id: z.string(), name: z.string(), email: z.string() }),
})

const NestedContract = defineApiContract({
  method: 'POST',
  path: '/api/orders',
  baseUrl: 'https://api.example.com',
  body: z.object({
    items: z.array(z.object({ sku: z.string(), qty: z.number() })),
    shipping: z.discriminatedUnion('type', [
      z.object({ type: z.literal('pickup'), storeId: z.string() }),
      z.object({ type: z.literal('courier'), address: z.string(), comment: z.string().optional() }),
    ]),
  }),
  response: z.object({
    order: z.object({ id: z.string(), total: z.number() }),
    nullableNote: z.string().nullable(),
  }),
})

describe('defineApiContract type inference', () => {
  it('captures the method and path literals', () => {
    expectTypeOf(GetUser.method).toEqualTypeOf<'GET'>()
    expectTypeOf(GetUser.path).toEqualTypeOf<'/api/users/:id'>()
  })

  it('derives path params from the path string', () => {
    expectTypeOf<PathParams<'/api/users/:id'>>().toEqualTypeOf<{ id: string }>()
    expectTypeOf<PathParams<'/api/posts/:postId/comments/:commentId'>>().toEqualTypeOf<{
      postId: string
      commentId: string
    }>()
    expectTypeOf<PathParams<'/api/users'>>().toEqualTypeOf<Record<never, never>>()
  })
})

describe('useApi type safety', () => {
  it('types data from the response schema (output side)', async () => {
    const { data } = await useApi(GetUser, { params: { id: '123' } })
    expectTypeOf(data.value?.name).toEqualTypeOf<string | undefined>()
    expectTypeOf(data.value?.email).toEqualTypeOf<string | undefined>()
    expectTypeOf(data.value?.id).toEqualTypeOf<string | undefined>()
  })

  it('accepts valid params', () => {
    useApi(GetUser, { params: { id: 'abc' } })
    useApi(GetUser)
  })

  it('rejects invalid params', () => {
    // @ts-expect-error id must be a string
    useApi(GetUser, { params: { id: 123 } })
  })

  it('rejects unknown params', () => {
    // @ts-expect-error unknown key
    useApi(GetUser, { params: { id: 'abc', foo: 'bar' } })
  })

  it('rejects missing required params', () => {
    const GetComment = defineApiContract({
      method: 'GET',
      path: '/api/posts/:postId/comments/:commentId',
      params: z.object({ commentId: z.string() }),
      response: z.object({ ok: z.boolean() }),
    })
    // @ts-expect-error postId is required by the path but missing from the schema
    useApi(GetComment, { params: { commentId: 'c1' } })
  })

  it('rejects a query object when the contract has no query schema', () => {
    // @ts-expect-error unknown query
    useApi(GetUser, { query: { page: 1 } })
  })

  it('types query options', () => {
    useApi(SearchUsers, { query: { page: 2, limit: 20, search: 'john' } })
    // @ts-expect-error limit must be a number
    useApi(SearchUsers, { query: { limit: '20' } })
    // @ts-expect-error unknown query key
    useApi(SearchUsers, { query: { unknown: true } })
  })

  it('types the body and rejects invalid bodies', () => {
    useApi(CreateUser, { body: { name: 'John', email: 'john@example.com' } })
    // @ts-expect-error email must be a string
    useApi(CreateUser, { body: { name: 'John', email: 123 } })
    // @ts-expect-error missing required body field
    useApi(CreateUser, { body: { name: 'John' } })
    // @ts-expect-error unknown body key
    useApi(CreateUser, { body: { name: 'John', email: 'j@e.com', admin: true } })
  })

  it('handles nested objects, arrays and discriminated unions', () => {
    useApi(NestedContract, {
      body: {
        items: [{ sku: 'A1', qty: 2 }],
        shipping: { type: 'pickup', storeId: 's1' },
      },
    })
    useApi(NestedContract, {
      body: {
        items: [{ sku: 'A1', qty: 2 }],
        shipping: { type: 'courier', address: 'Street 1', comment: 'call me' },
      },
    })
    useApi(NestedContract, {
      body: {
        items: [],
        // @ts-expect-error pickup shipping requires storeId
        shipping: { type: 'pickup' },
      },
    })
  })

  it('types nullable fields', async () => {
    const { data } = await useApi(NestedContract, {
      body: { items: [], shipping: { type: 'pickup', storeId: 's' } },
    })
    expectTypeOf(data.value?.nullableNote).toEqualTypeOf<string | null | undefined>()
  })
})

describe('defineContractHandler type safety', () => {
  it('types the validated context', () => {
    defineContractHandler(GetUser, async ({ params }) => {
      expectTypeOf(params.id).toEqualTypeOf<string>()
      // @ts-expect-error params is fully typed
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      params.unknown
      return { id: params.id, name: 'John', email: 'john@example.com' }
    })
  })

  it('rejects invalid handler responses', () => {
    // @ts-expect-error email must be a string
    defineContractHandler(GetUser, async ({ params }) => {
      return {
        id: params.id,
        name: 'John',
        email: 123,
      }
    })
  })

  it('types query and body in the context', () => {
    defineContractHandler(SearchUsers, async ({ query }) => {
      expectTypeOf(query.page).toEqualTypeOf<number>()
      expectTypeOf(query.search).toEqualTypeOf<string | undefined>()
      return { users: [], total: 0 }
    })
    defineContractHandler(CreateUser, async ({ body }) => {
      expectTypeOf(body.name).toEqualTypeOf<string>()
      return { id: '1', name: body.name, email: body.email }
    })
  })
})

describe('external API contracts (0.5.0)', () => {
  const GitHubUser = defineApiContract({
    name: 'GitHubUser',
    method: 'GET',
    path: 'https://api.github.com/users/:username',
    params: z.object({ username: z.string().min(1) }),
    response: z.object({ login: z.string(), id: z.number() }),
  })

  it('extracts path params from absolute URLs at the type level', () => {
    useApi(GitHubUser, { params: { username: 'nuxt' } })
    // @ts-expect-error username must be a string
    useApi(GitHubUser, { params: { username: 123 } })
    // @ts-expect-error unknown path parameter
    useApi(GitHubUser, { params: { username: 'nuxt', id: 'x' } })
  })

  it('types the response of external contracts', () => {
    const { data } = useApi(GitHubUser, { params: { username: 'nuxt' } })
    expectTypeOf(data.value?.login).toEqualTypeOf<string | undefined>()
    expectTypeOf(data.value?.id).toEqualTypeOf<number | undefined>()
  })

  it('keeps baseUrl contracts fully typed', () => {
    useApi(NestedContract, { body: { items: [], shipping: { type: 'pickup', storeId: 's' } } })
    // @ts-expect-error items must be an array of { sku, qty }
    useApi(NestedContract, { body: { items: [{ sku: 1, qty: 1 }], shipping: { type: 'pickup', storeId: 's' } } })
  })
})

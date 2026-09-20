import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineApiContract } from '../../src/client'
import { generateOpenApiDocument, toOpenApiPath, zodToJsonSchema } from '../../src/openapi'

const GetUser = defineApiContract({
  name: 'GetUser',
  method: 'GET',
  path: '/api/users/:id',
  summary: 'Get user',
  tags: ['Users'],
  params: z.object({ id: z.string().uuid() }),
  query: z.object({ expand: z.enum(['profile', 'posts']).optional() }),
  response: z.object({ id: z.string(), name: z.string(), createdAt: z.date().optional() }),
  errors: { USER_NOT_FOUND: z.object({ code: z.literal('USER_NOT_FOUND') }) },
})

const CreateUser = defineApiContract({
  method: 'POST',
  path: '/api/users',
  body: z.object({ name: z.string(), password: z.string() }),
  response: z.object({ id: z.string() }),
})

describe('toOpenApiPath', () => {
  it('converts :params into {params}', () => {
    expect(toOpenApiPath('/api/users/:id')).toBe('/api/users/{id}')
    expect(toOpenApiPath('/api/posts/:postId/comments/:commentId'))
      .toBe('/api/posts/{postId}/comments/{commentId}')
  })
})

describe('zodToJsonSchema', () => {
  it('maps strings with checks', () => {
    const schema = zodToJsonSchema(z.string().email().min(3), [], 'test')
    expect(schema).toMatchObject({ type: 'string', format: 'email', minLength: 3 })
  })

  it('maps numbers with int checks', () => {
    const schema = zodToJsonSchema(z.number().int().min(1).max(10), [], 'test')
    expect(schema).toMatchObject({ type: 'integer', minimum: 1, maximum: 10 })
  })

  it('maps objects with required fields', () => {
    const schema = zodToJsonSchema(z.object({ a: z.string(), b: z.string().optional() }), [], 'test')
    expect(schema).toMatchObject({ type: 'object', required: ['a'] })
  })

  it('represents refinements with a warning', () => {
    const warnings: Array<{ contract: string, message: string }> = []
    const schema = zodToJsonSchema(z.object({ n: z.number().refine(n => n > 0) }), warnings, 'test')
    expect(schema.type).toBe('object')
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('does not throw for exotic schemas', () => {
    const warnings: Array<{ contract: string, message: string }> = []
    expect(() => zodToJsonSchema(z.unknown() as never, warnings, 'test')).not.toThrow()
  })
})

describe('generateOpenApiDocument', () => {
  it('builds paths, parameters and responses', () => {
    const { document, warnings } = generateOpenApiDocument([GetUser, CreateUser], { title: 'Test API' })
    expect(warnings.filter(w => w.contract !== '(internal)')).toEqual([])
    expect(document.openapi).toBe('3.0.3')
    expect(document.info).toMatchObject({ title: 'Test API' })

    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>
    expect(Object.keys(paths)).toContain('/api/users/{id}')
    expect(Object.keys(paths)).toContain('/api/users')

    const getOperation = paths['/api/users/{id}']!.get!
    const parameters = getOperation.parameters as Array<Record<string, unknown>>
    expect(parameters.find(parameter => parameter.name === 'id')).toMatchObject({ in: 'path', required: true })
    expect(getOperation.tags).toEqual(['Users'])
    expect((getOperation.responses as Record<string, unknown>)['200']).toBeTruthy()
    expect(getOperation['x-error-codes']).toEqual(['USER_NOT_FOUND'])

    const postOperation = paths['/api/users']!.post!
    expect(postOperation.requestBody).toBeTruthy()
  })
})

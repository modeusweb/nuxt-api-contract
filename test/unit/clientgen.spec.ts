import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { z } from 'zod'
import { defineApiContract } from '../../src/client'
import { generateClientSource } from '../../src/clientgen/generator'
import { emitTsType, pathParamNames } from '../../src/clientgen/zodToTs'

function emit(schema: z.ZodTypeAny, mode: 'input' | 'output' = 'output') {
  const warnings: string[] = []
  const type = emitTsType(schema, mode, warnings)
  return { type, warnings }
}

/** Parses generated source and returns syntax diagnostics (empty = valid). */
function syntaxDiagnostics(source: string): string[] {
  const sf = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const raw = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics
  return (raw ?? []).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

describe('emitTsType', () => {
  it('maps scalar schemas', () => {
    expect(emit(z.string()).type).toBe('string')
    expect(emit(z.number()).type).toBe('number')
    expect(emit(z.coerce.number()).type).toBe('number')
    expect(emit(z.boolean()).type).toBe('boolean')
    expect(emit(z.date()).type).toBe('string')
    expect(emit(z.string().uuid()).type).toBe('string')
  })

  it('maps enums and literals', () => {
    expect(emit(z.enum(['a', 'b'])).type).toBe('"a" | "b"')
    expect(emit(z.literal('x')).type).toBe('"x"')
    expect(emit(z.literal(42)).type).toBe('42')
  })

  it('wraps optionals, nullables and defaults by mode', () => {
    expect(emit(z.object({ a: z.string().optional() })).type).toContain('"a"?: string')
    expect(emit(z.object({ a: z.string().nullable() })).type).toContain('"a": string | null')
    expect(emit(z.object({ a: z.string().default('x') }), 'output').type).toContain('"a": string')
    expect(emit(z.object({ a: z.string().default('x') }), 'input').type).toContain('"a"?: string')
  })

  it('handles arrays, records, unions, nested objects', () => {
    expect(emit(z.array(z.number())).type).toBe('Array<number>')
    expect(emit(z.record(z.string())).type).toBe('Record<string, string>')
    expect(emit(z.union([z.string(), z.number()])).type).toBe('string | number')
    const nested = z.object({ user: z.object({ id: z.string(), tags: z.array(z.string()) }) })
    expect(emit(nested).type).toContain('"tags": Array<string>')
  })

  it('emits warnings for transform and date', () => {
    const transformed = emit(z.string().transform(() => 1))
    expect(transformed.type).toBe('string')
    expect(transformed.warnings.length).toBeGreaterThan(0)
    expect(emit(z.date()).warnings.length).toBeGreaterThan(0)
  })
})

describe('pathParamNames', () => {
  it('extracts parameter names', () => {
    expect(pathParamNames('/api/users/:id')).toEqual(['id'])
    expect(pathParamNames('/api/posts/:postId/comments/:commentId')).toEqual(['postId', 'commentId'])
    expect(pathParamNames('/api/users')).toEqual([])
  })
})

describe('generateClientSource', () => {
  const GetUser = defineApiContract({
    name: 'GetUser',
    method: 'GET',
    path: '/api/users/:id',
    params: z.object({ id: z.string() }),
    query: z.object({ expand: z.array(z.enum(['profile', 'posts'])).optional() }),
    response: z.object({ id: z.string(), name: z.string(), email: z.string().email() }),
  })

  const CreateUser = defineApiContract({
    name: 'CreateUser',
    method: 'POST',
    path: '/api/users',
    body: z.object({ name: z.string(), email: z.string().email() }),
    response: z.object({ id: z.string() }),
  })

  const Anonymous = defineApiContract({
    method: 'DELETE',
    path: '/api/posts/:postId/comments/:commentId',
    response: z.object({ ok: z.boolean() }),
  })

  const { source } = generateClientSource([GetUser, CreateUser, Anonymous])

  it('produces syntactically valid TypeScript', () => {
    expect(syntaxDiagnostics(source)).toEqual([])
  })

  it('emits camelCase methods from contract names', () => {
    expect(source).toContain('async getUser(')
    expect(source).toContain("buildPath('/api/users/:id', input?.params)")
  })

  it('derives method names from method+path for anonymous contracts', () => {
    expect(source).toContain('async deleteApiPostsPostIdCommentsCommentId(')
  })

  it('emits named types for response, params, query, body', () => {
    expect(source).toContain('export interface GetUserResponse {')
    expect(source).toContain('export interface GetUserParams {')
    expect(source).toContain('export interface GetUserQuery {')
    expect(source).toContain('export interface CreateUserBody {')
    expect(source).toContain('"email": string')
  })

  it('merges path parameters into params interfaces', () => {
    expect(source).toContain('"id": string')
    expect(source).toContain('"postId": string')
    expect(source).toContain('"commentId": string')
  })

  it('makes params required when path demands it and body required when schema demands it', () => {
    expect(source).toMatch(/params: GetUserParams/)
    expect(source).toMatch(/body: CreateUserBody/)
    expect(source).toMatch(/query\?: GetUserQuery/)
  })

  it('emits Promise<Response> return types', () => {
    expect(source).toContain('Promise<GetUserResponse>')
    expect(source).toContain('Promise<CreateUserResponse>')
  })

  it('includes the standalone runtime (error class, config, helpers)', () => {
    expect(source).toContain('export class ContractClientError')
    expect(source).toContain('export interface ContractClientConfig')
    expect(source).toContain('function buildPath(')
    expect(source).toContain('function buildQueryString(')
    expect(source).not.toMatch(/from 'zod'|from "zod"/)
  })

  it('supports a custom factory name', () => {
    const custom = generateClientSource([GetUser], { factoryName: 'createApiClient' })
    expect(custom.source).toContain('export function createApiClient(')
    expect(syntaxDiagnostics(custom.source)).toEqual([])
  })

  it('handles multiple anonymous contracts without collisions', () => {
    const a = defineApiContract({ method: 'GET', path: '/api/a/:id', params: z.object({ id: z.string() }), response: z.object({ ok: z.boolean() }) })
    const b = defineApiContract({ method: 'GET', path: '/api/b/:id', params: z.object({ id: z.string() }), response: z.object({ ok: z.boolean() }) })
    const result = generateClientSource([a, b])
    expect(syntaxDiagnostics(result.source)).toEqual([])
  })

  it('warns for non-representable schemas instead of failing', () => {
    const Weird = defineApiContract({
      method: 'GET',
      path: '/api/weird',
      response: z.object({ value: z.string().transform(() => 42) }),
    })
    const result = generateClientSource([Weird])
    expect(syntaxDiagnostics(result.source)).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]?.message).toContain('transform')
  })
})
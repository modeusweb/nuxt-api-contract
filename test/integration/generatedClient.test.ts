import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { z } from 'zod'
import { defineApiContract } from '../../src/client'
import { generateClientSource } from '../../src/clientgen/generator'
import { generateMockResponse } from '../../src/runtime/shared/mock'
import { startMockServer } from '../../src/mock/server'

const GetUser = defineApiContract({
  name: 'GetUser',
  method: 'GET',
  path: '/api/users/:id',
  params: z.object({ id: z.string() }),
  query: z.object({ verbose: z.coerce.boolean().optional() }),
  response: z.object({ id: z.string(), name: z.string(), email: z.string().email() }),
})

const CreateUser = defineApiContract({
  name: 'CreateUser',
  method: 'POST',
  path: '/api/users',
  body: z.object({ name: z.string(), email: z.string().email() }),
  response: z.object({ id: z.string(), name: z.string() }),
})

const SEED = 42

describe('generated client against the mock server (e2e)', () => {
  let handle: Awaited<ReturnType<typeof startMockServer>>
  let client: { getUser: (input: { params: { id: string }, query?: { verbose?: boolean } }) => Promise<{ id: string, name: string, email: string }>, createUser: (input: { body: { name: string, email: string } }) => Promise<{ id: string, name: string }> }

  beforeAll(async () => {
    handle = await startMockServer({ contracts: [GetUser, CreateUser], port: 0, seed: SEED })
    // Generate the client, transpile to JS and import it as a real module.
    const { source } = generateClientSource([GetUser, CreateUser])
    const dir = mkdtempSync(join(tmpdir(), 'nac-generated-'))
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    const file = join(dir, 'client.mjs')
    writeFileSync(file, js, 'utf8')
    const mod = (await import(pathToFileURL(file).href)) as { createClient: (config: { baseUrl: string }) => typeof client }
    client = mod.createClient({ baseUrl: handle.url })
  })

  afterAll(async () => {
    await handle.close()
  })

  it('performs a typed GET with path and query params', async () => {
    const expected = generateMockResponse(GetUser, { seed: SEED })
    const data = await client.getUser({ params: { id: 'u1' }, query: { verbose: true } })
    expect(data).toEqual(expected)
    expect(typeof data.id).toBe('string')
    expect(typeof data.name).toBe('string')
  })

  it('performs a typed POST with a JSON body', async () => {
    const expected = generateMockResponse(CreateUser, { seed: SEED })
    const data = await client.createUser({ body: { name: 'John', email: 'john@example.com' } })
    expect(data).toEqual(expected)
  })

  it('surfaces server validation errors as ContractClientError', async () => {
    expect.assertions(3)
    try {
      await client.createUser({ body: { name: 'John', email: 'not-an-email' } })
    } catch (error) {
      expect((error as Error).name).toBe('ContractClientError')
      expect((error as { code: string }).code).toBe('VALIDATION_ERROR')
      expect((error as { statusCode: number }).statusCode).toBe(400)
    }
  })

  it('throws when a required path parameter is missing', async () => {
    expect.assertions(2)
    try {
      await client.getUser({ params: undefined as unknown as { id: string } })
    } catch (error) {
      expect((error as Error).name).toBe('ContractClientError')
      expect((error as { code: string }).code).toBe('VALIDATION_ERROR')
    }
  })
})
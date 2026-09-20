#!/usr/bin/env node
/**
 * `nuxt-api-contract` CLI.
 *
 * Commands:
 *   nuxt-api-contract openapi <entry> [--output openapi.json] [--title ...] [--version ...]
 *   nuxt-api-contract client <entry> [--output contract-client.ts] [--client-name createClient]
 *   nuxt-api-contract mock <entry> [--port 4000] [--seed 42] [--lenient]
 *
 * `<entry>` is a TypeScript/JavaScript module that exports contracts either
 * as a default array or as named exports (every export with
 * `kind === 'api-contract'` is picked up).
 */
import { createJiti } from 'jiti'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { generateOpenApiDocument, pickContracts } from './openapi/generator'
import type { AnyApiContract } from './runtime/shared/types'

interface CliArgs {
  command?: string
  positional: string[]
  flags: Record<string, string | boolean>
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  let command: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else if (!command) {
      command = arg
    } else {
      positional.push(arg)
    }
  }
  return { command, positional, flags }
}

/** Loads a user module (TS supported) and extracts exported contracts. */
async function loadContractsFromEntry(entry: string): Promise<AnyApiContract[]> {
  const jiti = createJiti(import.meta.url, { interopDefault: true })
  const loaded = (await jiti.import(entry)) as unknown
  const values: unknown[] = []

  if (Array.isArray(loaded)) {
    values.push(...loaded)
  } else if (loaded !== null && typeof loaded === 'object') {
    values.push(...Object.values(loaded as Record<string, unknown>))
  } else {
    throw new Error(`[nuxt-api-contract] Entry "${entry}" must export an array of contracts or named contract exports.`)
  }

  const contracts = pickContracts(values)
  if (contracts.length === 0) {
    throw new Error(`[nuxt-api-contract] No contracts (kind === 'api-contract') found in "${entry}".`)
  }
  return contracts
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2))

  if (command === 'openapi') {
    const entry = positional[0]
    if (!entry || !existsSync(entry)) {
      console.error('[nuxt-api-contract] Usage: nuxt-api-contract openapi <entry> [--output openapi.json]')
      process.exitCode = 1
      return
    }
    const contracts = await loadContractsFromEntry(resolve(entry))
    const { document, warnings } = generateOpenApiDocument(contracts, {
      title: typeof flags.title === 'string' ? flags.title : undefined,
      version: typeof flags.version === 'string' ? flags.version : undefined,
    })
    for (const warning of warnings) {
      console.warn(`[nuxt-api-contract] OpenAPI warning (${warning.contract}): ${warning.message}`)
    }
    const output = typeof flags.output === 'string'
      ? flags.output
      : flags.yaml === true ? 'openapi.yaml' : 'openapi.json'
    const content = flags.yaml === true
      ? toMinimalYaml(document)
      : `${JSON.stringify(document, null, 2)}\n`
    mkdirSync(dirname(resolve(output)), { recursive: true })
    writeFileSync(resolve(output), content, 'utf8')
    console.log(`[nuxt-api-contract] OpenAPI document with ${contracts.length} contract(s) written to ${output}`)
    return
  }

  if (command === 'client') {
    const entry = positional[0]
    if (!entry || !existsSync(entry)) {
      console.error('[nuxt-api-contract] Usage: nuxt-api-contract client <entry> [--output client.ts] [--client-name createClient]')
      process.exitCode = 1
      return
    }
    const contracts = await loadContractsFromEntry(resolve(entry))
    const { generateClientSource } = await import('./clientgen/generator')
    const { source, warnings } = generateClientSource(contracts, {
      factoryName: typeof flags['client-name'] === 'string' ? flags['client-name'] : undefined,
    })
    for (const warning of warnings) {
      console.warn(`[nuxt-api-contract] Client generation warning (${warning.contract}): ${warning.message}`)
    }
    const output = typeof flags.output === 'string' ? flags.output : 'contract-client.ts'
    mkdirSync(dirname(resolve(output)), { recursive: true })
    writeFileSync(resolve(output), source, 'utf8')
    console.log(`[nuxt-api-contract] Typed client with ${contracts.length} operation(s) written to ${output}`)
    return
  }

  if (command === 'mock') {
    const entry = positional[0]
    if (!entry || !existsSync(entry)) {
      console.error('[nuxt-api-contract] Usage: nuxt-api-contract mock <entry> [--port 4000] [--seed 42] [--lenient]')
      process.exitCode = 1
      return
    }
    const contracts = await loadContractsFromEntry(resolve(entry))
    const { startMockServer } = await import('./mock/server')
    const seed = flags.seed !== undefined && flags.seed !== true ? Number(flags.seed) : undefined
    const handle = await startMockServer({
      contracts,
      port: flags.port !== undefined && flags.port !== true ? Number(flags.port) : 4000,
      host: typeof flags.host === 'string' ? flags.host : '127.0.0.1',
      seed,
      delay: flags.delay !== undefined && flags.delay !== true ? Number(flags.delay) : undefined,
      lenient: flags.lenient === true,
    })
    console.log(`[nuxt-api-contract] Mock server listening on ${handle.url} (seed: ${seed ?? 'randomized per contract'}, lenient: ${flags.lenient === true})`)
    for (const contract of contracts) {
      console.log(`  ${contract.method.padEnd(6)} ${handle.url}${contract.path}`)
    }
    console.log('  GET    /__mock/contracts  (list endpoints)')
    console.log('Press Ctrl+C to stop.')
    const shutdown = async () => {
      await handle.close()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    return
  }

  console.error(`[nuxt-api-contract] Unknown command "${command ?? ''}". Available commands: openapi, client, mock`)
  process.exitCode = 1
}

/** Minimal, dependency-free YAML emitter (maps / arrays / scalars only). */
function toMinimalYaml(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value.map(item => `${pad}- ${toMinimalYaml(item, indent + 2).trimStart()}`).join('\n')
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return entries
      .map(([key, item]) => {
        const rendered = toMinimalYaml(item, indent + 2)
        if (item !== null && typeof item === 'object' && ((Array.isArray(item) && item.length > 0) || Object.keys(item).length > 0)) {
          return `${pad}${key}:\n${rendered}`
        }
        return `${pad}${key}: ${rendered.trimStart()}`
      })
      .join('\n')
  }
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

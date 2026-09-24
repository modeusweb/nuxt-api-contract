import type { ZodType } from 'zod'
import type { AnyApiContract } from './runtime/shared/types'
import { unwrapZodSchema } from './runtime/shared/zod-schema'

export type ContractCheckLevel = 'error' | 'warning'

export interface ContractCheckIssue {
  level: ContractCheckLevel
  contract: string
  message: string
}

export interface ContractCheckResult {
  issues: ContractCheckIssue[]
  errors: number
  warnings: number
}

function label(contract: AnyApiContract): string {
  return contract.name ?? `${contract.method} ${contract.path}`
}

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!)
}

function objectKeys(schema: ZodType | undefined): Set<string> | undefined {
  if (!schema) return undefined
  const unwrapped = unwrapZodSchema(schema)
  return unwrapped.descriptor.shape ? new Set(Object.keys(unwrapped.descriptor.shape)) : undefined
}

/** Performs build-time consistency checks without changing runtime behavior. */
export function checkContracts(contracts: readonly AnyApiContract[]): ContractCheckResult {
  const issues: ContractCheckIssue[] = []
  const add = (level: ContractCheckLevel, contract: AnyApiContract, message: string) => {
    issues.push({ level, contract: label(contract), message })
  }

  if (contracts.length === 0) {
    return {
      issues: [{ level: 'error', contract: '(entry)', message: 'No API contracts were found.' }],
      errors: 1,
      warnings: 0,
    }
  }

  const names = new Map<string, AnyApiContract>()
  const routes = new Map<string, AnyApiContract>()

  for (const contract of contracts) {
    if (contract.deprecated) {
      add('warning', contract, 'Contract is deprecated; migrate consumers before the sunset date.')
    }

    if (!contract.name) {
      add('warning', contract, 'Contract has no name; it will be less useful in registries, DevTools and generated tooling.')
    } else {
      const key = `${contract.name}#${contract.version ?? 'unversioned'}`
      const previous = names.get(key)
      if (previous) {
        add('error', contract, `Duplicate contract name/version "${key}".`)
      } else {
        names.set(key, contract)
      }
    }

    const routeKey = `${contract.method} ${contract.path}`
    const previousRoute = routes.get(routeKey)
    if (previousRoute) {
      add('error', contract, `Duplicate route "${routeKey}" conflicts with ${label(previousRoute)}.`)
    } else {
      routes.set(routeKey, contract)
    }

    const expected = pathParamNames(contract.path)
    const actual = objectKeys(contract.params)
    if (expected.length > 0 && !actual) {
      add('warning', contract, `Path contains ${expected.join(', ')}, but no object params schema was provided.`)
    } else if (actual) {
      for (const name of expected) {
        if (!actual.has(name)) add('error', contract, `Path parameter "${name}" is missing from params schema.`)
      }
      for (const name of actual) {
        if (!expected.includes(name)) add('warning', contract, `params schema contains "${name}", which is not present in the path.`)
      }
    }
  }

  const errors = issues.filter(issue => issue.level === 'error').length
  return { issues, errors, warnings: issues.length - errors }
}

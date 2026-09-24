/**
 * Contract coverage tracking: records which registered contracts have been
 * exercised through `callContract` / `testContract` (and with which outcome).
 * Enable it in a test setup hook and print the report in an after-hook:
 *
 * ```ts
 * import { startContractCoverage, formatContractCoverage, getContractCoverage } from 'nuxt-api-contract/testing'
 *
 * beforeAll(() => startContractCoverage())
 * afterAll(() => console.log(formatContractCoverage(getContractCoverage())))
 * ```
 */
import type { AnyApiContract, HttpMethod } from '../runtime/shared/types'
import { listRegisteredContracts } from '../runtime/shared/contract'

export interface ContractCoverageEntry {
  /** Contract name, or `METHOD path` for anonymous contracts. */
  key: string
  name?: string
  method: HttpMethod
  path: string
  calls: number
  failures: number
}

export interface ContractCoverageReport {
  /** Named contracts registered in the registry at report time. */
  total: number
  coveredCount: number
  percent: number
  covered: ContractCoverageEntry[]
  uncovered: Array<{ name?: string, method: HttpMethod, path: string }>
}

export interface CoverageThresholdResult {
  passed: boolean
  minimum: number
  actual: number
  message: string
}

/** Checks a coverage report against a required minimum percentage. */
export function assertContractCoverage(report: ContractCoverageReport, minimum: number): CoverageThresholdResult {
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
    throw new RangeError(`Coverage minimum must be between 0 and 100, received ${minimum}.`)
  }
  const passed = report.percent >= minimum
  return {
    passed,
    minimum,
    actual: report.percent,
    message: passed
      ? `Contract coverage ${report.percent}% meets the ${minimum}% threshold.`
      : `Contract coverage ${report.percent}% is below the ${minimum}% threshold (${report.coveredCount}/${report.total}).`,
  }
}

interface CoverageState {
  active: boolean
  entries: Map<string, ContractCoverageEntry>
}

const state: CoverageState = { active: false, entries: new Map() }

function entryKey(contract: AnyApiContract): string {
  return contract.name ?? `${contract.method} ${contract.path}`
}

/** Starts (and resets) coverage recording. */
export function startContractCoverage(): void {
  state.active = true
  state.entries.clear()
}

/** Stops recording and returns the final report. */
export function stopContractCoverage(): ContractCoverageReport {
  state.active = false
  return getContractCoverage()
}

/** Clears recorded stats without changing the active state. */
export function resetContractCoverage(): void {
  state.entries.clear()
}

/** Internal hook used by `callContract`. No-op unless coverage is active. */
export function recordCoverageCall(contract: AnyApiContract, success: boolean): void {
  if (!state.active) return
  const key = entryKey(contract)
  const entry = state.entries.get(key) ?? {
    key,
    name: contract.name,
    method: contract.method,
    path: contract.path,
    calls: 0,
    failures: 0,
  }
  entry.calls++
  if (!success) entry.failures++
  state.entries.set(key, entry)
}

/** Builds the coverage report against the currently registered contracts. */
export function getContractCoverage(): ContractCoverageReport {
  const covered = [...state.entries.values()].sort((a, b) => a.key.localeCompare(b.key))
  const coveredKeys = new Set(covered.map(entry => entry.key))

  const uncovered = listRegisteredContracts()
    .filter(contract => contract.name && !coveredKeys.has(contract.name))
    .map(contract => ({ name: contract.name!, method: contract.method, path: contract.path }))

  const total = uncovered.length + covered.length
  return {
    total,
    coveredCount: covered.length,
    percent: total === 0 ? 100 : Math.round((covered.length / total) * 100),
    covered,
    uncovered,
  }
}

/** Formats the report as a human-readable table for test output. */
export function formatContractCoverage(report: ContractCoverageReport): string {
  const lines = [
    'Contract coverage',
    `  ${report.coveredCount}/${report.total} contracts covered (${report.percent}%)`,
  ]
  if (report.covered.length > 0) {
    lines.push('Covered:')
    for (const entry of report.covered) {
      const status = entry.failures > 0 ? `${entry.calls - entry.failures}/${entry.calls} ok` : `${entry.calls} ok`
      lines.push(`  ✓ ${entry.method.padEnd(6)} ${entry.path.padEnd(32)} ${status}${entry.failures > 0 ? ` (${entry.failures} failed)` : ''}`)
    }
  }
  if (report.uncovered.length > 0) {
    lines.push('Uncovered:')
    for (const entry of report.uncovered) {
      lines.push(`  ✗ ${entry.method.padEnd(6)} ${entry.path}${entry.name ? `  (${entry.name})` : ''}`)
    }
  }
  return lines.join('\n')
}

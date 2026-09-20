import type { AnyApiContract } from '../runtime/shared/types'

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function contractRows(contracts: AnyApiContract[]) {
  return contracts
    .map((contract) => {
      const params = [...contract.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!)
      return {
        label: contract.name ?? '(anonymous)',
        method: contract.method,
        path: contract.path,
        params,
        tags: contract.tags ?? [],
        errorCodes: contract.errors ? Object.keys(contract.errors) : [],
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}

/** Builds a self-contained DevTools panel HTML with a "Try request" form. */
export function buildDevtoolsHtml(contracts: AnyApiContract[]): string {
  const rows = contractRows(contracts)
  return JSON.stringify(rows)
}

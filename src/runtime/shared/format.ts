import type { ZodError } from 'zod'

/**
 * A sanitized validation issue that is safe to send to the client.
 */
export interface ValidationIssue {
  /** Dotted path inside the validated value, e.g. `query.limit`. */
  path: string
  /** Human readable message. */
  message: string
  /** Expected type/shape description, when available. */
  expected?: string
  /** Short serialized received value. Only populated outside production. */
  received?: string
}

/** Maps a Zod error into sanitized validation issues. */
export function toValidationIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
    expected: 'expected' in issue ? String(issue.expected) : undefined,
    received: 'received' in issue ? truncateReceived(String(issue.received)) : undefined,
  }))
}

/**
 * Builds a developer-friendly multi-line message:
 *
 * ```
 * [nuxt-api-contract]
 *
 * Invalid query for GET /api/users
 *
 * query.limit:
 *   Expected number
 *   Received string
 * ```
 */
export function formatValidationMessage(options: {
  subject: string
  method: string
  path: string
  issues: ValidationIssue[]
  includeReceived?: boolean
}): string {
  const lines: string[] = [
    '[nuxt-api-contract]',
    '',
    `Invalid ${options.subject} for ${options.method} ${options.path}`,
    '',
  ]
  for (const issue of options.issues) {
    const path = issue.path === '(root)' ? options.subject : `${options.subject}.${issue.path}`
    lines.push(`${path}:`)
    lines.push(`  Expected ${issue.expected ?? issue.message}`)
    if (options.includeReceived !== false && issue.received !== undefined) {
      lines.push(`  Received ${issue.received}`)
    }
  }
  return lines.join('\n')
}

function truncateReceived(value: string, max = 80): string {
  const serialized = value.length > max ? `${value.slice(0, max)}…` : value
  return serialized
}

/**
 * Strips received values from issues (used before exposing issues in
 * production, where they may contain sensitive data such as passwords).
 */
export function sanitizeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({ ...issue, received: undefined }))
}

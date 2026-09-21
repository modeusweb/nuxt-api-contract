import type { ZodError } from 'zod'

/**
 * A sanitized validation issue that is safe to send to the client.
 */
export interface ValidationIssue {
  /** Dotted path inside the validated value, e.g. `limit`. */
  path: string
  /** Human readable message. */
  message: string
  /** Machine-readable Zod issue code (`invalid_type`, `too_small`, …). */
  code?: string
  /** Expected type/shape description, when available. */
  expected?: string
  /** Short serialized received value. Only populated by Zod 3 / outside production. */
  received?: string
}

/** Reads a string property of a Zod issue across majors without using `any`. */
function readString(issue: unknown, key: string): string | undefined {
  const value = (issue as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/** Maps a Zod error into sanitized validation issues. */
export function toValidationIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => {
    const record = issue as unknown as Record<string, unknown>
    const received = readString(issue, 'received')
    return {
      path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
      message: issue.message,
      // Zod 4 issues carry `code` and use `origin`/`format` instead of
      // `expected` for length and format checks; Zod 3 carries `received` too.
      code: readString(issue, 'code'),
      expected: readString(issue, 'expected')
        ?? readString(issue, 'format')
        ?? (record.minimum !== undefined ? `>= ${String(record.minimum)}` : undefined)
        ?? (record.maximum !== undefined ? `<= ${String(record.maximum)}` : undefined),
      received: received === undefined ? undefined : truncateReceived(received),
    }
  })
}

/**
 * Builds a developer-friendly multi-line message:
 *
 * ```text
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
    lines.push(`${qualifyPath(options.subject, issue.path)}:`)
    if (issue.expected) {
      lines.push(`  Expected ${issue.expected}`)
      if (options.includeReceived !== false && issue.received !== undefined) {
        lines.push(`  Received ${issue.received}`)
      }
    } else {
      // Zod 4 messages are already descriptive ("Too small: …").
      lines.push(`  ${issue.message}`)
    }
  }
  return lines.join('\n')
}

/** Prefixes an issue path with the validated subject exactly once. */
function qualifyPath(subject: string, path: string): string {
  if (path === '(root)') return subject
  if (path === subject || path.startsWith(`${subject}.`)) return path
  return `${subject}.${path}`
}

function truncateReceived(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * Strips received values from issues (used before exposing issues in
 * production, where they may contain sensitive data such as passwords).
 */
export function sanitizeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({ ...issue, received: undefined }))
}

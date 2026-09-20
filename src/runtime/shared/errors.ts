import type { ValidationIssue } from './format'

/**
 * Stable, machine-readable error payload sent over the wire.
 */
export interface ApiErrorPayload {
  error: {
    code: string
    message: string
    statusCode?: number
    details?: unknown
    issues?: ValidationIssue[]
  }
}

/**
 * Unified API error. Thrown on the server (and converted to an h3 error),
 * reconstructed on the client from the error payload.
 */
export class ApiError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly details?: unknown
  readonly issues?: ValidationIssue[]

  constructor(options: {
    code: string
    message: string
    statusCode?: number
    details?: unknown
    issues?: ValidationIssue[]
  }) {
    super(options.message)
    this.name = 'ApiError'
    this.code = options.code
    this.statusCode = options.statusCode ?? 500
    this.details = options.details
    this.issues = options.issues
  }

  toJSON(): ApiErrorPayload {
    return serializeApiError(this)
  }
}

export type CreateApiErrorInput = {
  code: string
  message?: string
  statusCode?: number
  details?: unknown
  issues?: ValidationIssue[]
}

/**
 * Creates a unified API error.
 *
 * ```ts
 * throw createApiError('USER_NOT_FOUND', 'User not found', 404)
 * throw createApiError({ code: 'VALIDATION_ERROR', statusCode: 400, details })
 * ```
 */
export function createApiError(input: CreateApiErrorInput): ApiError
export function createApiError(code: string, message?: string, statusCode?: number, details?: unknown): ApiError
export function createApiError(
  codeOrOptions: string | CreateApiErrorInput,
  message?: string,
  statusCode?: number,
  details?: unknown,
): ApiError {
  if (typeof codeOrOptions === 'string') {
    return new ApiError({ code: codeOrOptions, message: message ?? codeOrOptions, statusCode, details })
  }
  return new ApiError({
    code: codeOrOptions.code,
    message: codeOrOptions.message ?? codeOrOptions.code,
    statusCode: codeOrOptions.statusCode,
    details: codeOrOptions.details,
    issues: codeOrOptions.issues,
  })
}

/** Type guard for `ApiError` (works across module instances / payload objects). */
export function isApiError(value: unknown): value is ApiError {
  return (
    value instanceof ApiError
    || (typeof value === 'object'
      && value !== null
      && (value as { name?: unknown }).name === 'ApiError'
      && typeof (value as { code?: unknown }).code === 'string')
  )
}

/** Serializes an `ApiError` into the wire payload. */
export function serializeApiError(error: ApiError): ApiErrorPayload {
  return {
    error: {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      details: error.details,
      issues: error.issues,
    },
  }
}

/** Narrows an unknown parsed payload into an `ApiError` payload, if it matches. */
export function parseApiErrorPayload(value: unknown): ApiErrorPayload['error'] | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const error = (value as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return undefined
  const { code, message, statusCode, details, issues } = error as Record<string, unknown>
  if (typeof code !== 'string' || typeof message !== 'string') return undefined
  return {
    code,
    message,
    statusCode: typeof statusCode === 'number' ? statusCode : undefined,
    details,
    issues: Array.isArray(issues) ? (issues as ValidationIssue[]) : undefined,
  }
}

/** Wraps an unknown thrown value into an `ApiError`. */
export function toApiError(value: unknown, fallbackMessage = 'Internal server error'): ApiError {
  if (isApiError(value)) return value
  if (value instanceof Error) {
    return new ApiError({ code: 'INTERNAL_ERROR', message: value.message || fallbackMessage, statusCode: 500 })
  }
  return new ApiError({ code: 'INTERNAL_ERROR', message: fallbackMessage, statusCode: 500 })
}

/** Built-in error codes. */
export const BUILT_IN_ERROR_CODES = {
  validation: 'VALIDATION_ERROR',
  responseValidation: 'API_CONTRACT_RESPONSE_VALIDATION_ERROR',
  internal: 'INTERNAL_ERROR',
  notFound: 'NOT_FOUND',
  methodNotAllowed: 'METHOD_NOT_ALLOWED',
} as const

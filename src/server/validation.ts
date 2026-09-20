import type { ZodType } from 'zod'
import { z } from 'zod'
import {
  BUILT_IN_ERROR_CODES,
  createApiError,
} from '../runtime/shared/errors'
import { toValidationIssues, formatValidationMessage, sanitizeIssues } from '../runtime/shared/format'
import type { AnyApiContract } from '../runtime/shared/types'

export type ResponseValidationMode = 'never' | 'development' | 'always'

export interface RuntimeApiContractConfig {
  validateResponse?: ResponseValidationMode
  mocks?: boolean
}

/** Reads runtime contract config from the current Nitro runtime config. */
export function readRuntimeConfig(getConfig: () => unknown): RuntimeApiContractConfig {
  const config = getConfig() as { apiContract?: RuntimeApiContractConfig } | undefined
  return config?.apiContract ?? {}
}

/** Whether response validation is active for the current environment. */
export function shouldValidateResponse(mode: ResponseValidationMode | undefined): boolean {
  if (mode === 'always') return true
  if (mode === 'development') return process.env.NODE_ENV !== 'production'
  return false
}

/**
 * Validates an input (params / query / body / headers) against a schema and
 * throws a typed, developer-friendly `VALIDATION_ERROR` on failure.
 *
 * In production the "received" values are stripped from issues so that
 * sensitive data (passwords, tokens) is never echoed back.
 */
export function validateContractInput<S extends ZodType>(
  contract: AnyApiContract,
  subject: 'params' | 'query' | 'body' | 'headers',
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value)
  if (result.success) {
    return result.data as z.output<S>
  }
  const issues = toValidationIssues(result.error)
  const isProduction = process.env.NODE_ENV === 'production'
  throw createApiError({
    code: BUILT_IN_ERROR_CODES.validation,
    statusCode: 400,
    message: formatValidationMessage({
      subject,
      method: contract.method,
      path: contract.path,
      issues: isProduction ? sanitizeIssues(issues) : issues,
      includeReceived: !isProduction,
    }),
    details: { subject, issues: isProduction ? sanitizeIssues(issues) : issues },
    issues: isProduction ? sanitizeIssues(issues) : issues,
  })
}

/**
 * Validates a handler response against the contract's response schema.
 * Failures produce `API_CONTRACT_RESPONSE_VALIDATION_ERROR` with contract,
 * path, method and issues — but never expose the received payload in
 * production logs or responses.
 */
export function validateContractResponse<S extends ZodType>(
  contract: AnyApiContract,
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value)
  if (result.success) {
    return result.data as z.output<S>
  }
  const issues = toValidationIssues(result.error)
  const isProduction = process.env.NODE_ENV === 'production'
  const safeIssues = isProduction ? sanitizeIssues(issues) : issues
  throw createApiError({
    code: BUILT_IN_ERROR_CODES.responseValidation,
    statusCode: 500,
    message: formatValidationMessage({
      subject: 'response',
      method: contract.method,
      path: contract.path,
      issues: safeIssues,
      includeReceived: !isProduction,
    }),
    details: {
      contract: contract.name ?? '(anonymous)',
      path: contract.path,
      method: contract.method,
      issues: safeIssues,
    },
    issues: safeIssues,
  })
}

/**
 * Coerces a raw query object (all string values) before Zod validation is
 * applied by the caller. Kept as an explicit seam so `z.coerce` usage stays
 * documented and predictable.
 */
export function rawQuerySchema() {
  return z.record(z.string(), z.unknown())
}

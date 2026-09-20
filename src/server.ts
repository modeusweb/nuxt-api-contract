/**
 * Server-only API surface: `defineApiContract`, `defineContractHandler`,
 * `createApiError` and validation helpers. Must never be imported from
 * client bundles.
 */
export { defineApiContract, isApiContract, buildRequestPath, registerContract, getContractByName, listRegisteredContracts, clearContractRegistry, mockContract, getContractMock } from './runtime/shared/contract'
export type { ContractMock, MockResponseInput } from './runtime/shared/contract'
export {
  ApiError,
  createApiError,
  isApiError,
  serializeApiError,
  parseApiErrorPayload,
  toApiError,
  BUILT_IN_ERROR_CODES,
} from './runtime/shared/errors'
export type { ApiErrorPayload, CreateApiErrorInput } from './runtime/shared/errors'
export { toValidationIssues, formatValidationMessage, sanitizeIssues } from './runtime/shared/format'
export type { ValidationIssue } from './runtime/shared/format'
export { serializeQuery, serializeQueryValue, stableStringify } from './runtime/shared/serialization'
export type * from './runtime/shared/types'
export { defineContractHandler, type ContractHandlerContext, type ContractHandler } from './server/defineContractHandler'
export {
  shouldValidateResponse,
  validateContractInput,
  validateContractResponse,
  readRuntimeConfig,
  rawQuerySchema,
} from './server/validation'
export type { ResponseValidationMode, RuntimeApiContractConfig } from './server/validation'

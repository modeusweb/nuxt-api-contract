/**
 * Client-safe shared API surface (no server-only dependencies).
 */
export { defineApiContract, isApiContract, buildRequestPath } from './runtime/shared/contract'
export {
  registerContract,
  getContractByName,
  listRegisteredContracts,
  clearContractRegistry,
  mockContract,
  getContractMock,
} from './runtime/shared/contract'
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

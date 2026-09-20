/**
 * `testContract` — a testing suite bound to a contract + handler.
 *
 * Framework-agnostic: every `expect*` method throws a
 * `ContractAssertionError` on failure, so it works with Vitest, Jest,
 * `node:assert` and any other runner that treats thrown errors as failures.
 *
 * ```ts
 * import { testContract } from 'nuxt-api-contract/testing'
 *
 * const user = testContract(GetUser, handler)
 *
 * it('returns the user', async () => {
 *   await user.expectSuccess({ params: { id: '1' } })
 * })
 * ```
 */
import type { EventHandler } from 'h3'
import type { AnyApiContract, ContractClientResponse } from '../runtime/shared/types'
import { ApiError, BUILT_IN_ERROR_CODES } from '../runtime/shared/errors'
import { validateContractResponse } from '../server/validation'
import type { ContractHandler } from '../server/defineContractHandler'
import { callContract } from './callContract'

type Awaitable<T> = T | Promise<T>

export type TestHandler<C extends AnyApiContract> =
  | ContractHandler<C>
  | EventHandler
  | ((ctx: Record<string, unknown>) => Awaitable<unknown>)

export interface ContractTestInput {
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: unknown
  headers?: Record<string, string>
}

/** Thrown by every failed `testContract` assertion. */
export class ContractAssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContractAssertionError'
  }
}

function describeCall(contract: AnyApiContract): string {
  return `${contract.method} ${contract.path}`
}

export interface ContractTestSuite<C extends AnyApiContract> {
  /** Runs the full pipeline (validation -> handler -> response validation). */
  call(input?: ContractTestInput): Promise<{ data: ContractClientResponse<C> | null, error: ApiError | null }>
  /** Asserts the call succeeds; returns the typed response data. */
  expectSuccess(input?: ContractTestInput): Promise<ContractClientResponse<C>>
  /** Asserts the call fails with (optionally) the given code and status. */
  expectError(input?: ContractTestInput, code?: string, statusCode?: number): Promise<ApiError>
  /** Asserts a `VALIDATION_ERROR`; optionally checks that issues cover the given paths. */
  expectValidationError(input?: ContractTestInput, issuePaths?: string[]): Promise<ApiError>
  /** Asserts the response validation catches a bad handler output. */
  expectResponseValidationError(
    input: ContractTestInput,
    badResponse: unknown | ((ctx: Record<string, unknown>) => unknown),
  ): Promise<ApiError>
  /** Validates an arbitrary value against the contract's response schema. */
  validateResponse(value: unknown): void
}

/**
 * Creates a test suite for a contract + handler pair.
 *
 * ```ts
 * const suite = testContract(GetUser, handler)
 *
 * await suite.expectSuccess({ params: { id: '1' } })
 * await suite.expectError({ params: { id: 'missing' } }, 'USER_NOT_FOUND', 404)
 * await suite.expectValidationError({ params: { id: '' } }, ['params.id'])
 * ```
 */
export function testContract<C extends AnyApiContract>(
  contract: C,
  handler: TestHandler<C>,
): ContractTestSuite<C> {
  const suite: ContractTestSuite<C> = {
    async call(input) {
      return callContract(contract, handler, input)
    },

    async expectSuccess(input) {
      const { data, error } = await callContract(contract, handler, input)
      if (error) {
        throw new ContractAssertionError(
          `[nuxt-api-contract] Expected success for ${describeCall(contract)}, got ${error.code} (${error.statusCode}): ${error.message}`,
        )
      }
      return data as ContractClientResponse<C>
    },

    async expectError(input, code, statusCode) {
      const { data, error } = await callContract(contract, handler, input)
      if (!error) {
        throw new ContractAssertionError(
          `[nuxt-api-contract] Expected an error for ${describeCall(contract)}, but the call succeeded with: ${JSON.stringify(data)}`,
        )
      }
      if (code && error.code !== code) {
        throw new ContractAssertionError(
          `[nuxt-api-contract] Expected error code "${code}" for ${describeCall(contract)}, got "${error.code}" (${error.message})`,
        )
      }
      if (statusCode !== undefined && error.statusCode !== statusCode) {
        throw new ContractAssertionError(
          `[nuxt-api-contract] Expected status ${statusCode} for ${describeCall(contract)}, got ${error.statusCode}`,
        )
      }
      return error
    },

    async expectValidationError(input, issuePaths) {
      const error = await suite.expectError(input, BUILT_IN_ERROR_CODES.validation, 400)
      if (issuePaths && issuePaths.length > 0) {
        const actual = new Set((error.issues ?? []).map(issue => issue.path))
        const missing = issuePaths.filter((path) => {
          for (const actualPath of actual) {
            if (actualPath === path || actualPath.endsWith(`.${path}`) || path.endsWith(`.${actualPath}`) || actualPath.startsWith(`${path}.`)) return false
          }
          return true
        })
        if (missing.length > 0) {
          throw new ContractAssertionError(
            `[nuxt-api-contract] Expected validation issues for ${[...missing].join(', ')} on ${describeCall(contract)}, got: ${(error.issues ?? []).map(issue => issue.path).join(', ') || '(none)'}`,
          )
        }
      }
      return error
    },

    async expectResponseValidationError(input, badResponse) {
      const raw = badResponse
      const badHandler: TestHandler<C> = typeof raw === 'function'
        ? (raw as unknown as TestHandler<C>)
        : ((_ctx: Record<string, unknown>) => raw as unknown)
      const { error } = await callContract(contract, badHandler, input)
      if (!error) {
        throw new ContractAssertionError(
          `[nuxt-api-contract] Expected a response validation failure for ${describeCall(contract)}, but the call succeeded`,
        )
      }
      if (error.code !== BUILT_IN_ERROR_CODES.responseValidation) {
        throw new ContractAssertionError(
          `[nuxt-api-contract] Expected "${BUILT_IN_ERROR_CODES.responseValidation}" for ${describeCall(contract)}, got "${error.code}" (${error.message})`,
        )
      }
      return error
    },

    validateResponse(value) {
      if (!contract.response) return
      try {
        validateContractResponse(contract, contract.response, value)
      } catch (error) {
        if (error instanceof ApiError) {
          throw new ContractAssertionError(`[nuxt-api-contract] Response validation failed: ${error.message}`)
        }
        throw error
      }
    },
  }

  return suite
}

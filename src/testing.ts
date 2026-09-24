/**
 * Testing barrel: contract test helpers (server context).
 */
export { callContract, contractHandlerMetaKey } from './testing/callContract'
export type { ContractHandlerMeta } from './testing/callContract'
export { testContract, ContractAssertionError } from './testing/contractTest'
export type {
  ContractTestSuite,
  ContractTestInput,
  TestHandler,
} from './testing/contractTest'
export {
  startContractCoverage,
  stopContractCoverage,
  resetContractCoverage,
  getContractCoverage,
  formatContractCoverage,
  assertContractCoverage,
} from './testing/coverage'
export type { ContractCoverageReport, ContractCoverageEntry, CoverageThresholdResult } from './testing/coverage'

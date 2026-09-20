/**
 * Standalone mock server & mock generators (tooling entry — never part of
 * the client bundle).
 *
 * ```bash
 * npx nuxt-api-contract mock contracts/index.ts --port 4000 --seed 42
 * ```
 */
export { generateMockValue, generateMockResponse, autoMockContract, createRng } from './runtime/shared/mock'
export type { MockGenerateOptions } from './runtime/shared/mock'
export { createMockServer, startMockServer, buildMockMatchers } from './mock/server'
export type { MockServerOptions, MockServerHandle } from './mock/server'

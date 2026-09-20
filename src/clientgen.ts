/**
 * Client generation barrel (build-time only — never import from runtime code).
 */
export {
  generateClientSource,
} from './clientgen/generator'
export type {
  ClientGenerationOptions,
  ClientGenerationResult,
  GenerationWarning,
} from './clientgen/generator'
export {
  emitNamedType,
  emitTsType,
  pathParamNames,
} from './clientgen/zodToTs'
export type { EmissionMode } from './clientgen/zodToTs'

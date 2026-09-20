/**
 * OpenAPI generation barrel (build-time / CLI only — never in client bundles).
 */
export {
  generateOpenApiDocument,
  zodToJsonSchema,
  contractToOperation,
  toOpenApiPath,
  pickContracts,
} from './openapi/generator'
export type { OpenApiOptions, OpenApiGenerationResult, GenerationWarning, JsonSchemaObject } from './openapi/generator'

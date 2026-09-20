/**
 * Nitro route serving the generated OpenAPI document.
 * The document is injected at build time via the `#api-contracts-openapi`
 * virtual module (see the module setup).
 */
// @ts-expect-error build-time virtual module provided by nuxt-api-contract
import { document } from '#api-contracts-openapi'
import { defineEventHandler, setHeader } from 'h3'

export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'application/json')
  return document
})

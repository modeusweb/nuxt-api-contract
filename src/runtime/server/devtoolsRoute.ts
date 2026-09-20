/**
 * Nitro route serving the DevTools panel (static HTML built at build time).
 * The HTML is injected via the `#api-contracts-devtools` virtual module.
 */
// @ts-expect-error build-time virtual module provided by nuxt-api-contract
import { html } from '#api-contracts-devtools'
import { defineEventHandler, setHeader } from 'h3'

export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'text/html')
  return html
})

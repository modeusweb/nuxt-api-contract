import { fileURLToPath } from 'node:url'

/**
 * `API_CONTRACT_MODULE=dist` runs the playground against the *built* package
 * (`dist/module.mjs`) instead of the module source, which exercises the
 * npm-consumer code path — notably the `dist/client.mjs` branch of the
 * auto-import entry resolution and `dist/runtime/**` Nitro routes.
 */
const moduleEntry = process.env.API_CONTRACT_MODULE === 'dist'
  ? fileURLToPath(new URL('../dist/module.mjs', import.meta.url))
  : '../src/module'

export default defineNuxtConfig({
  modules: [moduleEntry],
  apiContract: {
    validateResponse: 'development',
    mocks: false,
    devtools: true,
    openapi: {
      enabled: true,
      path: '/_api-contracts/openapi.json',
      entry: 'contracts/index.ts',
      title: 'Playground API',
    },
  },
})

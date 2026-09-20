export default defineNuxtConfig({
  modules: ['../src/module'],
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

import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    'src/module',
    'src/client',
    'src/shared',
    'src/composables',
    'src/server',
    'src/testing',
    'src/openapi',
    'src/cli',
  ],
  declaration: 'compatible',
  clean: true,
  externals: [
    '@nuxt/kit',
    '@nuxt/schema',
    'nuxt',
    '#app',
    '#imports',
    'h3',
    'ofetch',
    'zod',
    'jiti',
    'defu',
    /^#api-contracts/,
  ],
  rollup: {
    emitCJS: false,
    inlineDependencies: true,
  },
})

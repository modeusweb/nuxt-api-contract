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
    'src/clientgen',
    'src/mock',
    'src/cli',
    // Runtime files referenced by path (Nitro routes served via
    // addServerHandler) must be shipped preserving the directory structure.
    {
      builder: 'mkdist',
      input: 'src/runtime',
      outDir: 'dist/runtime',
      ext: 'mjs',
      declaration: false,
    },
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

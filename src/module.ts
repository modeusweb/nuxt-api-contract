import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import {
  addImports,
  addImportsDir,
  addServerHandler,
  addServerTemplate,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import { defu } from 'defu'
import { createJiti } from 'jiti'
import type { AnyApiContract } from './runtime/shared/types'
import { generateOpenApiDocument, pickContracts } from './openapi/generator'
import { buildDevtoolsHtml } from './module/devtoolsHtml'

/* ------------------------------------------------------------------ *
 * Module options
 * ------------------------------------------------------------------ */

export interface ApiContractModuleOptions {
  /**
   * Response validation mode:
   * - `never`: skip response validation.
   * - `development` (default): validate outside production builds.
   * - `always`: validate in every environment.
   */
  validateResponse?: 'never' | 'development' | 'always'
  /** OpenAPI generation (build time) and serving. */
  openapi?: {
    enabled?: boolean
    /** Route serving the generated document. */
    path?: string
    /** Module exporting contracts (default array or named exports). */
    entry?: string
    title?: string
    version?: string
    description?: string
    output?: string
    /** Treat unsupported schema warnings as build errors. */
    strict?: boolean
  }
  /**
   * Mock mode:
   * - `false` (default): real handlers.
   * - `true`: use mocks registered via `mockContract()`.
   * - `'auto'`: use registered mocks, and generate mock responses
   *   from the response schemas for contracts without an explicit mock.
   */
  mocks?: boolean | 'auto'
  /** Nuxt DevTools panel (no-op when DevTools is not installed). */
  devtools?: boolean
  /** Directories scanned for contract auto-imports. */
  contractsDirs?: string[]
}

export type ModuleOptions = ApiContractModuleOptions

export type ModuleHooks = Record<string, never>

const CONFIG_KEY = 'apiContract'

const OPENAPI_DEFAULTS = {
  enabled: false,
  path: '/_api-contracts/openapi.json',
  entry: 'contracts/index.ts',
}

/* ------------------------------------------------------------------ *
 * Module
 * ------------------------------------------------------------------ */

export default defineNuxtModule<ApiContractModuleOptions>({
  meta: {
    name: 'nuxt-api-contract',
    configKey: CONFIG_KEY,
    compatibility: {
      nuxt: '>=3.15.0',
    },
  },
  defaults: {
    validateResponse: 'development',
    openapi: OPENAPI_DEFAULTS,
    mocks: false,
    devtools: true,
    contractsDirs: ['contracts', 'server/contracts'],
  },
  async setup(options: ApiContractModuleOptions, nuxt: Nuxt) {
    const resolver = createResolver(import.meta.url)
    const rootDir = nuxt.options.rootDir

    /**
     * Resolves a public entry point to a concrete file.
     *
     * Auto-import sources must be resolvable by the module that *reads* them
     * (Nuxt/unimport), not only by the bundler. Bare package specifiers such as
     * `nuxt-api-contract/client` only resolve when the package is installed in
     * `node_modules` — they fail when the module is consumed from source
     * (`modules: ['../src/module']`, module development, the playground) or
     * when `dist` is not built yet, and Nuxt then silently skips every
     * auto-import (`NUXT_B6005`). Resolving relative to `import.meta.url` works
     * in both layouts: `dist/module.mjs` -> `dist/client.mjs` and
     * `src/module.ts` -> `src/client.ts`.
     */
    const resolveEntry = (entry: './client' | './composables' | './server'): string => {
      const base = resolver.resolve(entry)
      for (const extension of ['.ts', '.mjs', '.js']) {
        if (existsSync(`${base}${extension}`)) return `${base}${extension}`
      }
      return base
    }
    const clientEntry = resolveEntry('./client')
    const composablesEntry = resolveEntry('./composables')
    const serverEntry = resolveEntry('./server')

    /* --- runtime config (secrets never go to `public`) --- */
    const mocksEnabled = options.mocks === true || options.mocks === 'auto'
    nuxt.options.runtimeConfig.apiContract = defu(nuxt.options.runtimeConfig.apiContract ?? {}, {
      validateResponse: options.validateResponse ?? 'development',
      mocks: mocksEnabled,
      mocksAuto: options.mocks === 'auto',
    })
    nuxt.options.runtimeConfig.public.apiContract = defu(nuxt.options.runtimeConfig.public.apiContract ?? {}, {
      mocks: mocksEnabled,
    })

    /* --- app auto-imports --- */
    addImports([
      { from: clientEntry, name: 'defineApiContract' },
      { from: clientEntry, name: 'createApiError' },
      { from: clientEntry, name: 'isApiError' },
      { from: clientEntry, name: 'mockContract' },
      { from: clientEntry, name: 'versionedPath' },
      { from: clientEntry, name: 'getContractVersion' },
      { from: clientEntry, name: 'negotiateContractVersion' },
      { from: clientEntry, name: 'listContractVersions' },
      { from: composablesEntry, name: 'useApi' },
      { from: composablesEntry, name: 'useApiClient' },
      { from: serverEntry, name: 'defineContractHandler' },
      { from: serverEntry, name: 'defineVersionedHandlers' },
      { from: serverEntry, name: 'resolveRequestedApiVersion' },
    ])

    // Nitro-side auto-imports (server routes can rely on these names too).
    // Typed loosely: the hook is provided by the Nitro integration.
    const hooks = nuxt.hooks as unknown as {
      hook: (name: string, fn: (config: { imports?: Record<string, unknown> }) => void) => void
    }
    hooks.hook('nitro:config', (nitroConfig) => {
      nitroConfig.imports = defu(nitroConfig.imports ?? {}, {
        presets: [
          {
            from: serverEntry,
            imports: ['defineContractHandler', 'createApiError', 'defineApiContract', 'defineVersionedHandlers', 'resolveRequestedApiVersion', 'versionedPath'],
          },
        ],
      })
    })

    /* --- contract auto-imports from user directories --- */
    for (const dir of options.contractsDirs ?? []) {
      const absolute = resolve(rootDir, dir)
      if (existsSync(absolute)) addImportsDir(absolute)
    }

    /* --- OpenAPI generation + serving --- */
    const openapi = { ...OPENAPI_DEFAULTS, ...(options.openapi ?? {}) }
    let contracts: AnyApiContract[] = []
    const openapiEnabled = openapi.enabled === true
    const devtoolsActive = Boolean(options.devtools) && nuxt.options.dev === true

    // The contract entry feeds both the OpenAPI document and the DevTools
    // panel — load it when either feature needs it (not only for OpenAPI).
    if (openapiEnabled || devtoolsActive) {
      const entryPath = isAbsolute(openapi.entry!) ? openapi.entry! : resolve(rootDir, openapi.entry!)
      if (!existsSync(entryPath)) {
        console.warn(
          openapiEnabled
            ? `[nuxt-api-contract] OpenAPI entry "${openapi.entry}" not found; generation skipped.`
            : `[nuxt-api-contract] Contract entry "${openapi.entry}" not found; the DevTools panel will be empty.`,
        )
      } else {
        const jiti = createJiti(import.meta.url, { interopDefault: true })
        const loaded = (await jiti.import(entryPath)) as unknown
        const values: unknown[] = Array.isArray(loaded)
          ? [...loaded]
          : loaded !== null && typeof loaded === 'object'
            ? Object.values(loaded as Record<string, unknown>)
            : []
        contracts = pickContracts(values)
      }
    }

    if (openapiEnabled && contracts.length > 0) {
      // `addServerTemplate` is the documented way to expose build-time data to
      // the Nitro build: Nitro resolves `#api-contracts-openapi` itself, so the
      // handler needs no alias written into `buildDir` (which also kept the
      // document stale across dev rebuilds).
      addServerTemplate({
        filename: '#api-contracts-openapi',
        getContents: () => {
          const { document, warnings } = generateOpenApiDocument(contracts, {
            title: openapi.title,
            version: openapi.version,
            description: openapi.description,
            strict: openapi.strict,
          })
          for (const warning of warnings) {
            console.warn(`[nuxt-api-contract] OpenAPI warning (${warning.contract}): ${warning.message}`)
          }
          return `export const document = ${JSON.stringify(document)}\n`
        },
      })
      addServerHandler({
        route: openapi.path!,
        handler: resolver.resolve('./runtime/server/openapiRoute'),
      })
    }

    /* --- DevTools panel (optional, no hard runtime dependency) --- */
    if (devtoolsActive) {
      addServerTemplate({
        filename: '#api-contracts-devtools',
        getContents: () => `export const html = ${JSON.stringify(buildDevtoolsHtml(contracts))}\n`,
      })
      const devtoolsRoute = '/_api-contracts'
      addServerHandler({
        route: devtoolsRoute,
        handler: resolver.resolve('./runtime/server/devtoolsRoute'),
      })
      try {
        const devtoolsKitModule = '@nuxt/devtools-kit'
        const { addCustomTab } = await import(/* @vite-ignore */ devtoolsKitModule)
        addCustomTab({
          name: 'nuxt-api-contract',
          title: 'API Contracts',
          icon: 'carbon:api',
          view: { type: 'iframe', src: devtoolsRoute },
        })
      } catch {
        // DevTools is optional: without it the package works normally.
      }
    }
  },
})

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { addImports, addServerHandler, createResolver, defineNuxtModule } from '@nuxt/kit'
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
      { from: 'nuxt-api-contract/client', name: 'defineApiContract' },
      { from: 'nuxt-api-contract/client', name: 'createApiError' },
      { from: 'nuxt-api-contract/client', name: 'isApiError' },
      { from: 'nuxt-api-contract/client', name: 'mockContract' },
      { from: 'nuxt-api-contract/composables', name: 'useApi' },
      { from: 'nuxt-api-contract/composables', name: 'useApiClient' },
      { from: 'nuxt-api-contract/server', name: 'defineContractHandler' },
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
            from: 'nuxt-api-contract/server',
            imports: ['defineContractHandler', 'createApiError', 'defineApiContract'],
          },
        ],
      })
    })

    /* --- contract auto-imports from user directories --- */
    for (const dir of options.contractsDirs ?? []) {
      const absolute = resolve(rootDir, dir)
      if (existsSync(absolute)) {
        nuxt.options.imports.dirs = [...(nuxt.options.imports.dirs ?? []), relative(nuxt.options.rootDir, absolute).replaceAll('\\', '/')]
      }
    }

    /* --- OpenAPI generation + serving --- */
    const openapi = { ...OPENAPI_DEFAULTS, ...(options.openapi ?? {}) }
    let contracts: AnyApiContract[] = []
    const openapiEnabled = openapi.enabled === true

    if (openapiEnabled) {
      const entryPath = isAbsolute(openapi.entry!) ? openapi.entry! : resolve(rootDir, openapi.entry!)
      if (!existsSync(entryPath)) {
        console.warn(`[nuxt-api-contract] OpenAPI entry "${openapi.entry}" not found; generation skipped.`)
      } else {
        const jiti = createJiti(import.meta.url, { interopDefault: true })
        const loaded = (await jiti.import(entryPath)) as unknown
        const values: unknown[] = Array.isArray(loaded)
          ? [...loaded]
          : loaded !== null && typeof loaded === 'object'
            ? Object.values(loaded as Record<string, unknown>)
            : []
        contracts = pickContracts(values)
        const { document, warnings } = generateOpenApiDocument(contracts, {
          title: openapi.title,
          version: openapi.version,
          description: openapi.description,
        })
        for (const warning of warnings) {
          console.warn(`[nuxt-api-contract] OpenAPI warning (${warning.contract}): ${warning.message}`)
        }
        const buildDir = resolve(nuxt.options.buildDir, 'api-contracts')
        mkdirSync(buildDir, { recursive: true })
        const outputPath = resolve(buildDir, 'openapi.mjs')
        writeFileSync(outputPath, `export const document = ${JSON.stringify(document)}\n`, 'utf8')
        nuxt.options.alias['#api-contracts-openapi'] = outputPath
        addServerHandler({
          route: openapi.path!,
          handler: resolver.resolve('./runtime/server/openapiRoute'),
        })
      }
    }

    /* --- DevTools panel (optional, no hard runtime dependency) --- */
    if (options.devtools && nuxt.options.dev) {
      const buildDir = resolve(nuxt.options.buildDir, 'api-contracts')
      mkdirSync(buildDir, { recursive: true })
      const htmlPath = resolve(buildDir, 'devtools.mjs')
      writeFileSync(htmlPath, `export const html = ${JSON.stringify(buildDevtoolsHtml(contracts))}\n`, 'utf8')
      nuxt.options.alias['#api-contracts-devtools'] = htmlPath
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

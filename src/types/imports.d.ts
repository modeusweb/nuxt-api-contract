/**
 * Local development shims for Nuxt auto-import aliases used by runtime code.
 *
 * These declarations are ONLY used when typechecking this repository outside
 * of a Nuxt app (vitest typecheck, `tsc -p tsconfig.json`). Inside a real
 * Nuxt app the generated `.nuxt` types provide the real declarations, and
 * this file is not shipped in the package `dist` types.
 */

/** Nuxt/Vite environment flags used by runtime code. */
interface ImportMeta {
  readonly server: boolean
  readonly client: boolean
  readonly env: {
    DEV?: boolean
    PROD?: boolean
    MODE?: string
  }
}

declare module '#imports' {
  import type { Ref } from 'vue'
  import type { H3Event } from 'h3'

  export interface AsyncDataLike<ResT, ErrT = unknown> {
    data: Ref<ResT | null>
    error: Ref<ErrT | null>
    pending: Ref<boolean>
    status: Ref<'idle' | 'pending' | 'success' | 'error'>
    refresh: () => Promise<void>
    execute: () => Promise<void>
  }

  export function useNuxtApp(): {
    $fetch: (url: string, init?: Record<string, unknown>) => Promise<unknown>
  }

  export function useRequestEvent(): H3Event | undefined

  export function useAsyncData<ResT, ErrT = unknown>(
    key: string,
    handler: () => Promise<ResT>,
    options?: {
      deep?: boolean
      dedupe?: 'defer' | 'cancel'
      immediate?: boolean
      default?: () => ResT | null
      server?: boolean
      lazy?: boolean
    },
  ): AsyncDataLike<ResT, ErrT>
}

declare module '#app' {
  export type AsyncData<ResT, ErrT = unknown> = import('#imports').AsyncDataLike<ResT, ErrT>
}

/**
 * Vitest stubs for Nuxt auto-imports used by runtime code.
 * Unit tests never invoke these; they only need module resolution to succeed.
 */
export function useNuxtApp(): { $fetch: (url: string, init?: Record<string, unknown>) => Promise<unknown> } {
  throw new Error('[nuxt-api-contract] #imports stub used outside of a Nuxt app')
}

export function useRequestEvent(): undefined {
  return undefined
}

export function useAsyncData(): never {
  throw new Error('[nuxt-api-contract] #imports stub used outside of a Nuxt app')
}

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '#imports': r('./test/stubs/imports.ts'),
      '#app': r('./test/stubs/imports.ts'),
    },
  },
  test: {
    include: ['test/unit/**/*.spec.ts', 'test/integration/**/*.test.ts'],
    typecheck: {
      enabled: false,
      include: ['test/type/**/*.test-d.ts'],
      tsconfig: 'tsconfig.typecheck.json',
      ignoreSourceErrors: true,
    },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})

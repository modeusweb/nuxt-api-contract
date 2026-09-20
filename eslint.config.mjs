// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({
  features: {
    stylistic: false,
  },
}, {
  files: ['src/runtime/shared/types.ts'],
  rules: {
    // `ZodType<any, any, infer I>` variance boundaries are required for
    // inference of optional schemas; `unknown` cannot be used there.
    '@typescript-eslint/no-explicit-any': 'off',
  },
}, {
  ignores: ['dist/**', 'playground/.nuxt/**', 'playground/.output/**', '.nuxt/**'],
  rules: {
    'vue/multi-word-component-names': 'off',
  },
})

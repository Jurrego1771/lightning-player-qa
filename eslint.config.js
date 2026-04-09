// eslint.config.js — ESLint 9 flat config
// Targets test files only; general TS linting is handled by tsc.
const playwright = require('eslint-plugin-playwright')
const tsParser = require('@typescript-eslint/parser')

module.exports = [
  {
    ...playwright.configs['flat/recommended'],
    files: ['tests/**/*.spec.ts'],
    languageOptions: {
      ...playwright.configs['flat/recommended'].languageOptions,
      parser: tsParser,
    },
    rules: {
      ...playwright.configs['flat/recommended'].rules,

      // waitForEvent() is a sufficient assertion — don't require explicit expect
      'playwright/expect-expect': 'off',

      // Intentional test.skip() guards exist (missing test data, env conditions)
      'playwright/no-skipped-test': 'warn',

      // Guard patterns (if skippable...) are intentional in some ad/DVR tests
      'playwright/no-conditional-in-test': 'warn',

      // Spanish titles and PascalCase section names are intentional
      'playwright/prefer-lowercase-title': 'off',

      // page.waitForTimeout() used where event-based waiting is not possible (CDP tests)
      'playwright/no-wait-for-timeout': 'warn',
    },
  },
]

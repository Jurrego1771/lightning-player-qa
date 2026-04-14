/**
 * playwright.media.config.ts — Igual que playwright.config.ts pero con
 * screenshot y video habilitados para TODOS los tests (pasen o fallen).
 * Uso: npx playwright test --config=playwright.media.config.ts
 */
import { defineConfig, devices } from '@playwright/test'
import * as dotenv from 'dotenv'
import { getEnvironment, getEnvironmentConfig } from './config/environments'

dotenv.config()

const IS_CI = process.env.CI === 'true'
const ENV = getEnvironment()
const ENV_CONFIG = getEnvironmentConfig()

console.log(`\n🎯 Ambiente: ${ENV_CONFIG.name} (${ENV})`)
console.log(`📦 Player: ${ENV_CONFIG.playerScriptUrl}\n`)

export default defineConfig({
  testDir: './tests',
  globalSetup: './setup/global-setup.ts',
  globalTeardown: './setup/global-teardown.ts',

  webServer: [
    {
      command: 'npx serve harness -p 3000 --cors',
      url: 'http://localhost:3000',
      reuseExistingServer: !IS_CI,
      timeout: 30_000,
    },
    {
      command: 'node scripts/serve-streams.js',
      url: 'http://localhost:9001',
      reuseExistingServer: !IS_CI,
      timeout: 30_000,
    },
    {
      command: 'ts-node mock-vast/server.ts',
      url: 'http://localhost:9999/health',
      reuseExistingServer: !IS_CI,
      timeout: 30_000,
    },
  ],

  retries: IS_CI ? 2 : 1,
  workers: IS_CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/report.json' }],
  ],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on',
    // Screenshot y video en TODOS los tests (pasen o fallen)
    screenshot: 'on',
    video: 'on',

    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-web-security',
        '--allow-running-insecure-content',
        '--disable-features=CrossSiteDocumentBlockingIfIsolating,IsolateOrigins,SitePerProcess',
      ],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['tests/e2e/**', 'tests/integration/**', 'tests/smoke/**'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: ['tests/e2e/**', 'tests/smoke/**'],
    },
  ],
})

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

  // Servidor local para streams HLS fixture (usados por isolatedPlayer)
  // Generarlos con: bash scripts/generate-fixtures.sh
  webServer: {
    command: 'npx serve fixtures/streams -p 9001 --cors -l',
    url: 'http://localhost:9001',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },

  retries: IS_CI ? 0 : 1,
  workers: IS_CI ? 2 : undefined,

  // Timeout generoso: el player carga desde CDN en cada test
  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ...(IS_CI ? [['github'] as ['github']] : []),
  ],

  use: {
    // Sin baseURL — el harness se carga via setContent(), no goto()
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',

    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-web-security', // permite cargar scripts cross-origin en tests
      ],
    },
  },

  projects: [
    // ── Tier 1: corre en cada PR / daily en dev ───────────────────────────
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ENV_CONFIG.testSuite === 'full'
        ? ['tests/e2e/**', 'tests/integration/**', 'tests/a11y/**', 'tests/visual/**', 'tests/smoke/**']
        : ['tests/smoke/**'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      // Firefox solo en E2E (no integration/visual/a11y para ser eficientes)
      testMatch: ENV_CONFIG.testSuite === 'full'
        ? ['tests/e2e/**', 'tests/smoke/**']
        : ['tests/smoke/**'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: ENV_CONFIG.testSuite === 'full'
        ? ['tests/e2e/**', 'tests/smoke/**']
        : ['tests/smoke/**'],
    },

    // ── Performance: solo en chromium (CDP disponible) ────────────────────
    {
      name: 'performance',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['tests/performance/**'],
    },

    // ── Mobile simulado ───────────────────────────────────────────────────
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      testMatch: ENV_CONFIG.testSuite === 'full'
        ? ['tests/e2e/**']
        : ['tests/smoke/**'],
    },
  ],
})

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

  // Tres servidores locales:
  //   :3000 — harness HTML (evita el origin null de page.setContent())
  //   :9001 — HLS streams fixture (generados con npm run fixtures:generate)
  //   :9999 — mock VAST server (respuestas VAST/VMAP controladas para tests de ads)
  webServer: [
    {
      command: 'npx serve harness -p 3000 --cors',
      url: 'http://localhost:3000',
      reuseExistingServer: !IS_CI,
      timeout: 30_000,
    },
    {
      // fixtures/streams/ se genera con `npm run fixtures:generate` (requiere ffmpeg).
      // scripts/serve-streams.js crea el directorio si no existe (cross-platform)
      // para que el servidor arranque aunque los fixtures no existan aún.
      // checkHlsFixtures() en globalSetup los genera automáticamente si ffmpeg está disponible.
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

  // Timeout generoso: el player carga desde CDN en cada test
  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/report.json' }],
    ['./reporters/flakiness-reporter.ts'],
    ...(IS_CI ? [['github'] as ['github']] : []),
  ],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',

    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-web-security',          // permite cargar scripts cross-origin
        '--allow-running-insecure-content', // IMA SDK en http:// sin bloqueo
        '--disable-features=CrossSiteDocumentBlockingIfIsolating,IsolateOrigins,SitePerProcess', // permite iframes del IMA SDK en headless
      ],
    },
  },

  projects: [
    // ── Contract: corre primero en CI — falla rápido si el player rompió su API ─
    {
      name: 'contract',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['tests/contract/**'],
    },

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

import { defineConfig, devices } from '@playwright/test'
import * as dotenv from 'dotenv'

dotenv.config()

const BASE_URL = process.env.PLAYER_BASE_URL ?? 'http://localhost:3000'
const IS_CI = process.env.CI === 'true'

export default defineConfig({
  testDir: './tests',

  // En CI, sin retries confunden el diagnóstico; localmente 1 retry ayuda
  retries: IS_CI ? 0 : 1,

  // Paralelismo: en CI limitado para no saturar; local aprovecha cores
  workers: IS_CI ? 2 : undefined,

  // Timeout generoso para players con buffering inicial
  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ...(IS_CI ? [['github'] as ['github']] : []),
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',

    // Los players de video necesitan permisos de autoplay
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },

  projects: [
    // ── Tier 1: corre en cada PR ──────────────────────────────────────────
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['tests/e2e/**', 'tests/integration/**', 'tests/a11y/**', 'tests/visual/**'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: ['tests/e2e/**'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: ['tests/e2e/**'],
    },

    // ── Performance: solo en chromium (CDP disponible) ────────────────────
    {
      name: 'performance',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['tests/performance/**'],
    },

    // ── Mobile: simulado ──────────────────────────────────────────────────
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      testMatch: ['tests/e2e/**'],
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
      testMatch: ['tests/e2e/**'],
    },
  ],
})

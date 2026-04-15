/**
 * playwright.reels-evidence.config.ts
 * Config temporal para correr tests de Reels con evidencia completa (screenshot + video en cada test).
 * Uso: npx playwright test -c playwright.reels-evidence.config.ts
 */
import { defineConfig, devices } from '@playwright/test'
import baseConfig from './playwright.config'
import * as dotenv from 'dotenv'

dotenv.config()

export default defineConfig({
  ...baseConfig,
  use: {
    ...baseConfig.use,
    video: 'on',
    screenshot: 'on',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
})

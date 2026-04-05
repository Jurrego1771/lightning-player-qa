/**
 * Configuración de Playwright para BrowserStack (Tier 2 — Nightly)
 * Requiere BROWSERSTACK_USERNAME y BROWSERSTACK_ACCESS_KEY en .env
 *
 * Uso: npx playwright test --config playwright.browserstack.config.ts
 */
import { defineConfig } from '@playwright/test'
import * as dotenv from 'dotenv'

dotenv.config()

const BS_CDP_ENDPOINT = `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify({
  browser: 'chrome',
  browser_version: 'latest',
  os: 'Windows',
  os_version: '11',
  'browserstack.username': process.env.BROWSERSTACK_USERNAME,
  'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY,
  'browserstack.local': false,
  build: `lightning-player-qa-nightly-${new Date().toISOString().split('T')[0]}`,
  project: 'Lightning Player QA',
})}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  retries: 1,
  workers: 5, // BrowserStack permite concurrencia según plan

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-bs', open: 'never' }],
  ],

  use: {
    connectOptions: { wsEndpoint: BS_CDP_ENDPOINT },
    baseURL: process.env.PLAYER_BASE_URL,
  },

  // Los proyectos específicos de BrowserStack se configuran via caps
  projects: [
    { name: 'BS-Chrome-Win11', use: {} },
  ],
})

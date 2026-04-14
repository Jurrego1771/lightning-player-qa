/**
 * playwright.tv.config.ts — Configuración de Playwright para LG webOS TV físico
 *
 * Conecta via CDP al browser del TV a través del tunnel SSH que abre deploy-webos.sh.
 *
 * Uso:
 *   # 1. Deployar y abrir tunnel (una vez)
 *   bash scripts/deploy-webos.sh
 *
 *   # 2. Correr los tests TV
 *   npx playwright test --config=playwright.tv.config.ts
 *
 *   # 3. Correr un spec específico
 *   npx playwright test tests/e2e/tv-back-key-codes.spec.ts --config=playwright.tv.config.ts
 *
 * Solo corre tests marcados con @tv-hardware.
 * Los tests fixme en la suite desktop se convierten en tests activos aquí
 * porque el entorno nativo webOS sí soporta los keyboard events del hook useTVNavigation.
 */
import { defineConfig } from '@playwright/test'
import * as dotenv from 'dotenv'
import { getWebOSCDPTarget } from './scripts/connect-webos-cdp'

dotenv.config()

// Activar los tests @tv-hardware (se saltan en desktop si esta variable no está en 'true')
process.env.TV_HARDWARE = 'true'

const LOCAL_CDP_PORT = parseInt(process.env.WEBOS_LOCAL_CDP_PORT || '9222', 10)

export default defineConfig({
  testDir: './tests',

  // Solo tests marcados con @tv-hardware
  grep: /@tv-hardware/,

  // El TV es más lento — timeouts extendidos
  timeout:         120_000,
  expect:          { timeout: 30_000 },

  // 1 worker: el TV tiene un solo browser, no puede paralelizar
  workers: 1,

  // 1 retry: los tests TV pueden ser lentos en el primer intento (cold start)
  retries: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-tv', open: 'never' }],
    ['json', { outputFile: 'playwright-report-tv/report.json' }],
  ],

  use: {
    // Conectar via CDP al tunnel SSH (localhost:LOCAL_CDP_PORT → TV:9998)
    // Playwright toma control del browser ya corriendo en el TV
    cdpUrl: `http://localhost:${LOCAL_CDP_PORT}`,

    // Sin baseURL — la app ya está cargada en el TV via ares-launch
    // Los tests no navegan, solo interactúan con la app ya abierta

    trace:      'on',           // siempre capturar trace en TV (debugging)
    screenshot: 'on',           // siempre capturar screenshot
    video:      'off',          // video no disponible via CDP remoto

    // Timeouts de acción extendidos para TV (D-pad es más lento que mouse)
    actionTimeout:     15_000,
    navigationTimeout: 60_000,
  },

  projects: [
    {
      name: 'webos-tv',
      // No usamos devices[] porque nos conectamos a un browser ya corriendo
      // El TV reporta su propio UA — no necesitamos emularlo
      use: {},
      testMatch: [
        'tests/e2e/tv-*.spec.ts',
        'tests/e2e/*-tv-*.spec.ts',
      ],
    },
  ],

  // No lanzar webServers locales — la app ya está en el TV
  // El player script se carga desde CDN directamente en el TV
})

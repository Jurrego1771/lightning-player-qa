/**
 * wdio.tizen.conf.ts — WebdriverIO config para Samsung Tizen TV
 *
 * Usa Appium + appium-tizen-tv-driver para conectarse al TV físico.
 * El servicio @wdio/appium-service arranca y detiene Appium automáticamente.
 *
 * Requiere:
 *   - TIZEN_DEVICE_IP, TIZEN_APP_ID, TIZEN_RC_TOKEN, TIZEN_CHROMEDRIVER_PATH en .env
 *   - sdb conectado al TV: sdb connect <TIZEN_DEVICE_IP>
 *   - appium-tizen-tv-driver instalado: npm run tizen:setup
 *
 * Correr:
 *   npm run test:tizen
 *   npm run test:tizen -- --spec tests/tv-tizen/playback.spec.ts
 */

import type { Options } from '@wdio/types'
import * as dotenv from 'dotenv'

dotenv.config()

const DEVICE_IP       = process.env.TIZEN_DEVICE_IP        || ''
const DEVICE_NAME     = process.env.TIZEN_DEVICE_NAME      || 'samsung1'
const APP_ID          = process.env.TIZEN_APP_ID           || 'com.mediastream.lightningqa'
const RC_TOKEN        = process.env.TIZEN_RC_TOKEN         || ''
const CHROMEDRIVER    = process.env.TIZEN_CHROMEDRIVER_PATH || ''
const LOCAL_CDP_PORT  = parseInt(process.env.TIZEN_LOCAL_CDP_PORT || '9223', 10)

if (!DEVICE_IP) {
  throw new Error('TIZEN_DEVICE_IP no configurado en .env')
}

if (!RC_TOKEN) {
  throw new Error(
    'TIZEN_RC_TOKEN no configurado en .env.\n' +
    'Obtenerlo con: npm run tizen:pair'
  )
}

export const config: Options.WebdriverIO = {
  runner: 'local',

  // Puerto del servidor Appium — arrancado por @wdio/appium-service
  port: 4723,

  maxInstances: 1,

  capabilities: [{
    platformName: 'tizentv',
    'appium:automationName': 'tizentv',

    // IP del TV + puerto sdb (siempre 26101 en Tizen)
    'appium:deviceName': `${DEVICE_IP}:26101`,

    // ID de la app instalada en el TV
    'appium:appPackage': APP_ID,

    // Token de emparejamiento del control remoto
    // Obtener con: npm run tizen:pair
    'appium:rcToken': RC_TOKEN,

    // rcMode 'js' → Chromedriver conecta al Chromium del TV (Tizen 8.0 / 2024+)
    // Habilita executeScript() para leer window.__qa y estado del player
    'appium:rcMode': 'js' as const,

    // Chromedriver que matchea la versión de Chromium del TV
    // Tizen 8.0 (2024): Chromium M120+
    // Verificar versión en: chrome://inspect → dispositivo conectado
    // Descargar: https://googlechromelabs.github.io/chrome-for-testing/
    ...(CHROMEDRIVER ? { 'appium:chromedriverExecutable': CHROMEDRIVER } : {}),

    // Cambiar automáticamente al contexto web (necesario para executeScript)
    'appium:autoWebview': true,
  }],

  specs: ['./tests/tv-tizen/**/*.spec.ts'],

  // Tags disponibles: @tv-tizen, @tv-tizen-smoke, @tv-tizen-playback
  // Filtrar con: npm run test:tizen -- --mochaOpts.grep "@tv-tizen-smoke"

  framework:  'mocha',
  mochaOpts:  {
    timeout: 120_000,   // TVs son más lentos que desktop
    retries: 1,         // 1 retry automático para flakiness de red
  },

  services: [
    ['appium', {
      args: {
        relaxedSecurity: true,
        log: './appium-tizen.log',
      },
    }],
  ],

  reporters: [
    ['spec', {
      realtimeReporting: true,
      showPreface:       false,
    }],
  ],

  // Timeout extendido para operaciones en el TV físico
  connectionRetryTimeout: 120_000,
  connectionRetryCount:   3,

  // waitforTimeout global para $element.waitForExist() etc.
  waitforTimeout: 30_000,

  before: async (_capabilities, _specs, browser) => {
    // Verificar que la app esté inicializada antes de empezar los tests
    await browser.waitUntil(
      async () => {
        try {
          const initialized = await browser.executeScript(
            'return window.__qa && window.__qa.initialized', []
          )
          return initialized === true
        } catch {
          return false
        }
      },
      {
        timeout:     60_000,
        timeoutMsg:  'Player no inicializado en el TV después de 60s. Verificar que la app esté corriendo.',
        interval:    2_000,
      }
    )
  },
}

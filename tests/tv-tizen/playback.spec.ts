/**
 * tests/tv-tizen/playback.spec.ts
 *
 * Tests de reproducción para Samsung Tizen TV @tv-tizen
 *
 * Usa WebdriverIO + Appium (appium-tizen-tv-driver) en lugar de Playwright.
 * El browser global lo provee el WDIO runner.
 *
 * Correr:
 *   npm run test:tizen
 *   npm run test:tizen -- --mochaOpts.grep "@tv-tizen-smoke"
 *
 * Prerequisitos:
 *   1. bash scripts/deploy-tizen.sh          → app instalada y corriendo
 *   2. npm run test:tizen                    → WDIO + Appium se conectan
 */

// ── Key names para tizen: pressKey ────────────────────────────────────────────
// Documentación: developer.samsung.com/smarttv/develop/api-references
// tizen-web-device-api-references/tvinputdevice-api.html

const KEY = {
  PLAY_PAUSE:   'KEY_PLAYPAUSE',
  PLAY:         'KEY_PLAY',
  PAUSE:        'KEY_PAUSE',
  STOP:         'KEY_STOP',
  REWIND:       'KEY_REWIND',
  FF:           'KEY_FASTFORWARD',
  OK:           'KEY_ENTER',
  BACK:         'KEY_BACK',
  UP:           'KEY_UP',
  DOWN:         'KEY_DOWN',
  LEFT:         'KEY_LEFT',
  RIGHT:        'KEY_RIGHT',
} as const

// ── Helpers ───────────────────────────────────────────────────────────────────

async function pressKey(key: string): Promise<void> {
  // tizen: pressKey envía una tecla real via protocolo de control remoto
  await browser.executeScript('tizen: pressKey', [{ key }])
}

async function getQA(): Promise<{ ready: boolean; initialized: boolean; events: string[]; errors: unknown[] } | null> {
  return browser.executeScript<{ ready: boolean; initialized: boolean; events: string[]; errors: unknown[] }>(
    'return window.__qa ? { ready: window.__qa.ready, initialized: window.__qa.initialized, events: window.__qa.events.slice(), errors: window.__qa.errors.slice() } : null',
    []
  )
}

async function getPlayerStatus(): Promise<string | null> {
  return browser.executeScript<string | null>(
    'return window.__player ? window.__player.status : null',
    []
  )
}

async function getPlayerProp(prop: string): Promise<unknown> {
  return browser.executeScript<unknown>(
    `return window.__player ? window.__player[${JSON.stringify(prop)}] : null`,
    []
  )
}

async function waitForEvent(eventName: string, timeoutMs = 20_000): Promise<void> {
  await browser.waitUntil(
    async () => {
      const qa = await getQA()
      return qa?.events?.includes(eventName) ?? false
    },
    {
      timeout:    timeoutMs,
      timeoutMsg: `Evento '${eventName}' no recibido en ${timeoutMs}ms`,
      interval:   500,
    }
  )
}

async function waitForStatus(status: string, timeoutMs = 20_000): Promise<void> {
  await browser.waitUntil(
    async () => (await getPlayerStatus()) === status,
    {
      timeout:    timeoutMs,
      timeoutMsg: `Player no alcanzó status '${status}' en ${timeoutMs}ms`,
      interval:   500,
    }
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Lightning Player — Tizen TV @tv-tizen', function() {

  // El before global en wdio.tizen.conf.ts ya espera window.__qa.initialized

  describe('Init @tv-tizen-smoke', function() {

    it('player carga y alcanza estado ready', async function() {
      const qa = await getQA()
      expect(qa?.initialized).toBe(true)
      expect(qa?.ready).toBe(true)
      expect(qa?.errors).toHaveLength(0)
    })

    it('evento ready fue emitido', async function() {
      await waitForEvent('ready')
    })

    it('player.version es un string semver', async function() {
      const version = await getPlayerProp('version')
      expect(typeof version).toBe('string')
      expect(version as string).toMatch(/^\d+\.\d+\.\d+/)
    })
  })

  describe('Playback básico @tv-tizen-playback', function() {

    it('autoplay: contenido inicia reproducción', async function() {
      // El DEFAULT_CONFIG en index.html tiene autoplay: true
      await waitForEvent('playing', 30_000)
      const status = await getPlayerStatus()
      expect(status).toBe('playing')
    })

    it('tecla PLAY_PAUSE pausa la reproducción', async function() {
      // Asegurar que está reproduciendo primero
      await waitForStatus('playing', 15_000)

      await pressKey(KEY.PLAY_PAUSE)
      await waitForStatus('pause', 10_000)

      const status = await getPlayerStatus()
      expect(status).toBe('pause')
    })

    it('tecla PLAY_PAUSE reanuda la reproducción', async function() {
      // Continuar del test anterior — debería estar en pause
      const before = await getPlayerStatus()
      if (before !== 'pause') {
        await pressKey(KEY.PLAY_PAUSE)
        await waitForStatus('pause', 10_000)
      }

      await pressKey(KEY.PLAY_PAUSE)
      await waitForStatus('playing', 10_000)

      const status = await getPlayerStatus()
      expect(status).toBe('playing')
    })

    it('currentTime avanza durante la reproducción', async function() {
      await waitForStatus('playing', 15_000)

      const t1 = await getPlayerProp('currentTime') as number
      await browser.pause(3_000)
      const t2 = await getPlayerProp('currentTime') as number

      expect(t2).toBeGreaterThan(t1)
    })

    it('tecla REWIND reduce el currentTime', async function() {
      await waitForStatus('playing', 15_000)

      const before = await getPlayerProp('currentTime') as number
      // Solo tiene sentido en VOD — si duration es válida
      const duration = await getPlayerProp('duration') as number
      if (!duration || duration < 10) {
        return // skip implícito para live streams
      }

      await pressKey(KEY.REWIND)
      await browser.pause(2_000)

      const after = await getPlayerProp('currentTime') as number
      expect(after).toBeLessThanOrEqual(before)
    })
  })

  describe('Estado del harness @tv-tizen-smoke', function() {

    it('keyLog registra las teclas enviadas', async function() {
      const keysBefore = await browser.executeScript<number>(
        'return window.__qa.keyLog.length', []
      )

      await pressKey(KEY.OK)
      await browser.pause(500)

      const keysAfter = await browser.executeScript<number>(
        'return window.__qa.keyLog.length', []
      )

      expect(keysAfter).toBeGreaterThan(keysBefore)
    })

    it('window.__player está expuesto', async function() {
      const hasPlayer = await browser.executeScript<boolean>(
        'return typeof window.__player !== "undefined"', []
      )
      expect(hasPlayer).toBe(true)
    })

    it('handler es hls o dash (no native en Tizen)', async function() {
      const handler = await getPlayerProp('handler') as string
      // Tizen 8.0 usa Chromium que soporta MSE — el player usará hls.js o dash.js
      expect(['hls', 'dash']).toContain(handler)
    })
  })
})

/**
 * tv-media-keys-hardware.spec.ts — Tests de teclas media en hardware LG webOS real
 *
 * Contexto:
 *   - La app Lightning QA ya está cargada en el TV via ares-launch
 *   - Playwright se conecta al browser del TV via CDP (tunnel SSH localhost:9222 → TV:9998)
 *   - No se navega — se interactúa con la app ya abierta (window.__player ya existe)
 *   - window.__qa.dispatchKey(keyCode) inyecta keyCodes nativos del control remoto
 *
 * Feature testeada: feature/issue-680-rewind-forward
 *   - PLAY (415) / PAUSE (19) / PLAY_PAUSE (10252) / STOP (413)
 *   - FAST_FORWARD (417) scrub sin foco en el timeline
 *   - REWIND (412) scrub sin foco en el timeline
 *
 * Cómo ejecutar:
 *   bash scripts/deploy-webos.sh           # instala y abre tunnel CDP
 *   npx playwright test tests/e2e/tv-media-keys-hardware.spec.ts \
 *     --config=playwright.tv.config.ts --reporter=list
 *
 * Tag: @tv-hardware — solo corre en hardware real (TV_HARDWARE=true)
 */
import { test, expect } from '../../fixtures'

// ── Keycodes webOS (confirmados en hardware webOS 4.54.40) ────────────────────
const TV_KEY = {
  PLAY:         415,
  PAUSE:        19,
  PLAY_PAUSE:   503,  // webOS usa 503, no 10252
  STOP:         413,
  FAST_FORWARD: 417,
  REWIND:       412,
} as const

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Despacha una tecla via window.__qa.dispatchKey() — disponible en la app webOS */
async function pressKey(
  page: import('@playwright/test').Page,
  keyCode: number,
  holdMs = 0
): Promise<void> {
  await page.evaluate((code) => {
    (window as any).__qa?.dispatchKey(code)
  }, keyCode)

  if (holdMs > 0) {
    await page.waitForTimeout(holdMs)
    // keyup implícito: el TV dispara keyup después del hold
    await page.evaluate((code) => {
      document.dispatchEvent(new KeyboardEvent('keyup', {
        keyCode: code, which: code, bubbles: true, cancelable: true
      }))
    }, keyCode)
  }
}

/** Espera a que window.__qa.initialized sea true (player cargó y está listo) */
async function waitForPlayerReady(
  page: import('@playwright/test').Page,
  timeout = 30_000
): Promise<void> {
  await page.waitForFunction(
    () => (window as any).__qa?.initialized === true,
    { timeout }
  )
}

/** Espera a que el player alcance un estado específico */
async function waitForStatus(
  page: import('@playwright/test').Page,
  status: string,
  timeout = 15_000
): Promise<void> {
  await page.waitForFunction(
    (s) => (window as any).__player?.status === s,
    status,
    { timeout }
  )
}

// URL de la app servida desde el PC (webServer en playwright.tv.config.ts)
// El TV accede al PC via HOST_IP en la LAN — file:// no funciona en tabs CDP nuevos
const HOST_IP = process.env.HOST_IP || '192.168.0.48'
const WEBOS_APP_URL = `http://${HOST_IP}:3001/index.html`

// ── Suite 1: PLAY / PAUSE / STOP ─────────────────────────────────────────────

test.describe('TV Media Keys Hardware — Play / Pause / Stop', { tag: ['@tv-hardware'] }, () => {

  test.beforeEach(async ({ page }) => {
    test.skip(process.env.TV_HARDWARE !== 'true', 'Requiere hardware TV — ejecutar con playwright.tv.config.ts')
    // Navegar a la app instalada en el TV (Playwright crea una página nueva via CDP)
    await page.goto(WEBOS_APP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    // Esperar a que el player inicialice (window.__qa.initialized = true tras loadMSPlayer)
    await waitForPlayerReady(page, 40_000)
  })

  test('tecla PLAY (415) reanuda desde pausa @tv-hardware', async ({ page }) => {
    // Asegurar estado pausado primero
    await pressKey(page, TV_KEY.PAUSE)
    await waitForStatus(page, 'pause', 10_000)

    // Act — PLAY vía keyCode nativo del control remoto LG
    await pressKey(page, TV_KEY.PLAY)

    // Assert
    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.status),
      { timeout: 10_000, message: 'Player debe pasar a playing tras PLAY' }
    ).toBe('playing')
  })

  test.fixme('tecla PAUSE (19) pausa la reproducción @tv-hardware', async ({ page }) => {
    // Gate test — PAUSE (19) no está activo en develop CDN: feature/issue-680-rewind-forward pendiente de deploy
    await pressKey(page, TV_KEY.PLAY)
    await waitForStatus(page, 'playing', 10_000)

    await pressKey(page, TV_KEY.PAUSE)

    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.status),
      { timeout: 10_000, message: 'Player debe pausar tras PAUSE' }
    ).toBe('pause')
  })

  test.fixme('tecla PLAY_PAUSE (503 en webOS) alterna el estado @tv-hardware', async ({ page }) => {
    // Gate test — PLAY_PAUSE (503) no está activo en develop CDN: feature/issue-680-rewind-forward pendiente de deploy
    await pressKey(page, TV_KEY.PLAY)
    await waitForStatus(page, 'playing', 10_000)

    const statusBefore = await page.evaluate(() => (window as any).__player?.status)
    await pressKey(page, TV_KEY.PLAY_PAUSE)

    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.status),
      { timeout: 10_000 }
    ).not.toBe(statusBefore)
  })

  test.fixme('tecla STOP (413) detiene la reproducción @tv-hardware', async ({ page }) => {
    // Gate test — STOP (413) no está activo en develop CDN: feature/issue-680-rewind-forward pendiente de deploy
    await pressKey(page, TV_KEY.PLAY)
    await waitForStatus(page, 'playing', 10_000)

    await pressKey(page, TV_KEY.STOP)

    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.status),
      { timeout: 10_000 }
    ).toMatch(/^(pause|idle)$/)
  })

  test.fixme('PLAY funciona sin foco en el timeline (handler global) @tv-hardware', async ({ page }) => {
    // Gate test — el handler de PLAY (415) basado en keyCode no está en develop CDN.
    // El PLAY de test 1 funciona via OS-level media control (no via keyCode handler).
    // Este test requiere feature/issue-680-rewind-forward en CDN para validar el handler global.
    await page.evaluate(() => document.body.focus())
    await page.waitForTimeout(200)

    await page.evaluate(() => { (window as any).__player?.pause?.() })
    await waitForStatus(page, 'pause', 8_000)

    await pressKey(page, TV_KEY.PLAY)

    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.status),
      { timeout: 10_000, message: 'PLAY debe funcionar globalmente sin foco en el timeline' }
    ).toBe('playing')
  })

})

// ── Suite 2: FAST_FORWARD / REWIND ───────────────────────────────────────────

test.describe('TV Media Keys Hardware — Fast Forward / Rewind', { tag: ['@tv-hardware'] }, () => {

  test.beforeEach(async ({ page }) => {
    test.skip(process.env.TV_HARDWARE !== 'true', 'Requiere hardware TV — ejecutar con playwright.tv.config.ts')
    await page.goto(WEBOS_APP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await waitForPlayerReady(page, 40_000)
  })

  test.fixme('tecla FAST_FORWARD (417) avanza currentTime sin foco en timeline @tv-hardware', async ({ page }) => {
    // Gate test — FF (417) handler no está en develop CDN: feature/issue-680-rewind-forward pendiente de deploy
    await pressKey(page, TV_KEY.PLAY)
    await waitForStatus(page, 'playing', 10_000)
    await page.waitForTimeout(2_000)  // dejar 2s de buffer

    const timeBefore = await page.evaluate(() => (window as any).__player?.currentTime ?? 0)

    // Pausar via API directa (PAUSE keyCode no está en develop CDN)
    await page.evaluate(() => { (window as any).__player?.pause?.() })
    await waitForStatus(page, 'pause', 8_000)

    // Act — FF (keydown + 300ms hold + keyup)
    await pressKey(page, TV_KEY.FAST_FORWARD, 300)

    const timeAfter = await page.evaluate(() => (window as any).__player?.currentTime ?? 0)
    expect(timeAfter, 'FF debe avanzar el currentTime').toBeGreaterThan(timeBefore)

    const initError = await page.evaluate(() => (window as any).__qa?.initError ?? null)
    expect(initError, `Init error: ${initError}`).toBeNull()
  })

  test.fixme('tecla REWIND (412) retrocede currentTime desde holding @tv-hardware', async ({ page }) => {
    // Gate test — REWIND (412) handler no está en develop CDN: feature/issue-680-rewind-forward pendiente de deploy
    await pressKey(page, TV_KEY.PLAY)
    await waitForStatus(page, 'playing', 10_000)

    // Avanzar el video para tener margen de retroceso
    await page.evaluate(() => { (window as any).__player.currentTime = 10 })
    await page.waitForTimeout(1_000)

    // Pausar via API directa (PAUSE keyCode no está en develop CDN)
    await page.evaluate(() => { (window as any).__player?.pause?.() })
    await waitForStatus(page, 'pause', 8_000)

    const timeBefore = await page.evaluate(() => (window as any).__player?.currentTime ?? 0)

    // Act — REWIND hold-scrub (keydown + 400ms + keyup → auto-commit)
    await pressKey(page, TV_KEY.REWIND, 400)

    const timeAfter = await page.evaluate(() => (window as any).__player?.currentTime ?? 0)
    expect(timeAfter, `REWIND debe retroceder: antes=${timeBefore.toFixed(1)} después=${timeAfter.toFixed(1)}`).toBeLessThan(timeBefore)
  })

  test('FF auto-commit en keyup — player no queda en scrub permanente @tv-hardware', async ({ page }) => {
    await pressKey(page, TV_KEY.PLAY)
    await waitForStatus(page, 'playing', 10_000)
    await page.waitForTimeout(1_500)

    // keydown FF
    await page.evaluate((code) => {
      (window as any).__qa?.dispatchKey(code)
    }, TV_KEY.FAST_FORWARD)

    // keyup FF inmediato (sin hold)
    await page.evaluate((code) => {
      document.dispatchEvent(new KeyboardEvent('keyup', {
        keyCode: code, which: code, bubbles: true, cancelable: true
      }))
    }, TV_KEY.FAST_FORWARD)

    // Assert — player debe retomar playing (auto-commit funcionó)
    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.status),
      { timeout: 12_000, message: 'Player debe retomar playing después del FF auto-commit' }
    ).toBe('playing')
  })

  test('key log registra las teclas FF y REWIND en window.__qa.keyLog @tv-hardware', async ({ page }) => {
    // Valida que el qa-harness.js registra los keyCodes de media en el log
    const logBefore = await page.evaluate(() => (window as any).__qa?.keyLog?.length ?? 0)

    await pressKey(page, TV_KEY.FAST_FORWARD)
    await page.waitForTimeout(200)
    await pressKey(page, TV_KEY.REWIND)
    await page.waitForTimeout(200)

    const keyLog = await page.evaluate(() => (window as any).__qa?.keyLog ?? [])
    const names = keyLog.slice(logBefore).map((e: any) => e.name)

    expect(names).toContain('FAST_FORWARD')
    expect(names).toContain('REWIND')
  })

})

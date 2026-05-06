/**
 * konodrac-tv-smoke.spec.ts — Validación de beacons Konodrac en hardware webOS TV
 *
 * Tag: @tv-hardware — solo corre con playwright.tv.config.ts
 *
 * IMPORTANTE: Con cdpUrl el fixture `page` es una página nueva (blank).
 * Navegamos esa página a la URL de la app en el TV filesystem para cargar
 * qa-harness.js + player y tener window.__qa disponible.
 *
 * - connectOverCDP() NO funciona en webOS (Browser.setDownloadBehavior unsupported)
 * - cdpUrl SÍ funciona para page.goto(), page.evaluate() y page.route()
 *
 * Estrategia dual de captura:
 *   1. window.__qa.konodracBeacons — Image patch en qa-harness.js (sin red)
 *   2. page.route(/konograma\.com/) — intercept a nivel CDP
 */

import { test, expect } from '@playwright/test'

// HOST_IP: IP del PC en la LAN (el TV debe poder acceder a este host).
// Configurar en .env: HOST_IP=192.168.0.48
// El TV carga la app desde el servidor del PC en lugar de file:// (sin permisos de sandbox).
const HOST_IP      = process.env.HOST_IP ?? '192.168.0.48'
const APP_URL      = `http://${HOST_IP}:3001/index.html`
const INIT_TIMEOUT = 60_000  // TV es lento cargando el CDN script

async function loadApp(page: import('@playwright/test').Page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForFunction(
    () => (window as any).__qa?.initialized === true || (window as any).__qa?.initError != null,
    { timeout: INIT_TIMEOUT }
  )
  const initError = await page.evaluate(() => (window as any).__qa?.initError)
  if (initError) throw new Error(`[loadApp] Player init error: ${initError}`)
}

// ── Grupo 0: Infraestructura TV ───────────────────────────────────────────────

test.describe('TV infra @tv-hardware', () => {

  test('window.__qa existe y está inicializado @tv-hardware', async ({ page }) => {
    await loadApp(page)

    const qa = await page.evaluate(() => ({
      ready:            (window as any).__qa?.initialized,
      hasEvents:        Array.isArray((window as any).__qa?.events),
      hasKonodracArray: Array.isArray((window as any).__qa?.konodracBeacons),
    }))

    expect(qa.ready).toBe(true)
    expect(qa.hasEvents).toBe(true)
    expect(qa.hasKonodracArray, 'Image patch no aplicado — verificar qa-harness.js').toBe(true)
  })

  test('player cargó y emitió ready @tv-hardware', async ({ page }) => {
    await loadApp(page)

    const status = await page.evaluate(() => (window as any).__player?.status ?? 'none')
    expect(['playing', 'pause', 'buffering', 'idle', 'waiting']).toContain(status)
  })

})

// ── Grupo 1: Image patch — mecanismo de captura ───────────────────────────────

test.describe('Konodrac Image patch @tv-hardware', () => {

  test('captura URL de konograma.com via window.__qa.konodracBeacons @tv-hardware', async ({ page }) => {
    await loadApp(page)

    const countBefore = await page.evaluate(() => (window as any).__qa.konodracBeacons.length as number)

    await page.evaluate(() => {
      var img = new Image()
      img.src = 'https://marker.konograma.com/track?dataset=TEST&event=smoke&cid=tv-test&sysEnv=webos&cb=' + Date.now()
    })

    const beacons = await page.evaluate(() => (window as any).__qa.konodracBeacons as string[])
    expect(beacons.length, 'Image patch no capturó el beacon').toBeGreaterThan(countBefore)

    const last = new URL(beacons[beacons.length - 1])
    expect(last.searchParams.get('event')).toBe('smoke')
    expect(last.searchParams.get('sysEnv')).toBe('webos')
  })

  test('patch no afecta imágenes no-konodrac @tv-hardware', async ({ page }) => {
    await loadApp(page)

    const countBefore = await page.evaluate(() => (window as any).__qa.konodracBeacons.length as number)

    await page.evaluate(() => {
      var img = new Image()
      img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
    })

    const countAfter = await page.evaluate(() => (window as any).__qa.konodracBeacons.length as number)
    expect(countAfter).toBe(countBefore)
  })

})

// ── Grupo 2: Beacons reales del player ────────────────────────────────────────

test.describe('Konodrac player beacons @tv-hardware', () => {

  test.beforeEach(async ({ page }) => {
    await loadApp(page)
    // Esperar que el player empiece a reproducir y dispare al menos mloaded + firstplay
    await page.waitForFunction(
      () => {
        const b = (window as any).__qa?.konodracBeacons as string[]
        return b?.some((u: string) => u.includes('event=firstplay'))
      },
      { timeout: INIT_TIMEOUT }
    )
  })

  test('beacon mloaded se disparó al cargar el player @tv-hardware', async ({ page }) => {
    const beacons = await page.evaluate(() => (window as any).__qa.konodracBeacons as string[])
    const mloaded = beacons.find(u => u.includes('event=mloaded'))

    expect(mloaded, 'beacon mloaded no encontrado').toBeDefined()

    const p = new URL(mloaded!).searchParams
    expect(p.get('playerStatus')).toBe('PAUSED')
    expect(Number(p.get('secsPlayed'))).toBe(0)
    expect(p.get('pageType')).toBe('VOD')
  })

  test('beacon firstplay se disparó al reproducir @tv-hardware', async ({ page }) => {
    const beacons = await page.evaluate(() => (window as any).__qa.konodracBeacons as string[])
    const firstplay = beacons.find(u => u.includes('event=firstplay'))

    expect(firstplay, 'beacon firstplay no encontrado').toBeDefined()

    const p = new URL(firstplay!).searchParams
    expect(p.get('playerStatus')).toBe('PLAYING')
    expect(Number(p.get('secsPlayed'))).toBe(0)
  })

  test('parámetros obligatorios presentes en todos los beacons @tv-hardware', async ({ page }) => {
    const beacons = await page.evaluate(() => (window as any).__qa.konodracBeacons as string[])
    expect(beacons.length, 'no hay beacons — verificar konodrac config en la plataforma').toBeGreaterThan(0)

    for (const raw of beacons) {
      const p = new URL(raw).searchParams
      expect(p.get('dataset'),         `dataset falta en ${p.get('event')}`).toBeTruthy()
      expect(p.get('cid'),             `cid falta en ${p.get('event')}`).toBeTruthy()
      expect(p.get('event'),           'event falta').toBeTruthy()
      expect(p.get('playerStatus'),    `playerStatus falta en ${p.get('event')}`).toBeTruthy()
      expect(p.get('secsPlayed'),      `secsPlayed falta en ${p.get('event')}`).not.toBeNull()
      expect(p.get('currentPosition'), `currentPosition falta en ${p.get('event')}`).not.toBeNull()
      expect(p.get('pageType'),        `pageType falta en ${p.get('event')}`).toBeTruthy()
    }
  })

})

// ── Grupo 3: CDP route — validación de red real ───────────────────────────────

test.describe('Konodrac beacons via CDP route @tv-hardware', () => {

  test('beacon manual llega a marker.konograma.com via red @tv-hardware', async ({ page }) => {
    await loadApp(page)

    const captured: string[] = []
    await page.route(/marker\.konograma\.com/, async (route) => {
      captured.push(route.request().url())
      await route.continue()
    })

    await page.evaluate(() => {
      var img = new Image()
      img.src = 'https://marker.konograma.com/track?dataset=CARTV_OTT_TEST&event=smoke&cid=tv-test&channel=CARTV&pageType=VOD&sysEnv=webos&secsPlayed=0&playerStatus=PLAYING&currentPosition=0&gdpr=1&gdpr_consent=MOCK&cb=' + Date.now()
    })

    await expect.poll(() => captured.length, { timeout: 15_000 }).toBeGreaterThan(0)

    const p = new URL(captured[0]).searchParams
    expect(p.get('event')).toBe('smoke')
    expect(p.get('sysEnv')).toBe('webos')

    await page.unroute(/marker\.konograma\.com/)
  })

  test('beacons reales del player pasan por CDP route @tv-hardware', async ({ page }) => {
    const captured: string[] = []
    await page.route(/marker\.konograma\.com/, async (route) => {
      captured.push(route.request().url())
      await route.continue()
    })

    await loadApp(page)

    // Esperar primer beacon del player (mloaded se dispara al init)
    await expect.poll(() => captured.length, { timeout: INIT_TIMEOUT }).toBeGreaterThan(0)

    const firstBeacon = new URL(captured[0]).searchParams
    expect(firstBeacon.get('event')).toBeTruthy()
    expect(firstBeacon.get('dataset')).toBeTruthy()
    expect(firstBeacon.get('cid')).toBeTruthy()

    await page.unroute(/marker\.konograma\.com/)
  })

})

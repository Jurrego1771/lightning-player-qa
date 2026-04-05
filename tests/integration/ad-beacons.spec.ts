/**
 * ad-beacons.spec.ts — Tests de integración para anuncios y beacons VAST
 *
 * Valida el ciclo completo de un ad: request → playback → beacons → content resume.
 * Usa el mock-vast/server.ts para responses VAST controladas.
 * Intercepta requests de red con Playwright para verificar beacons sin disparar URLs reales.
 *
 * PREREQUISITO: iniciar el mock-vast server antes de correr (o usar globalSetup)
 */
import { test, expect, Streams } from '../../fixtures'

const MOCK_VAST_URL = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

test.describe('Ad Beacons — VAST Pre-roll', () => {
  test('pre-roll: secuencia completa de beacons (impression → start → quartiles → complete)', async ({ player, adBeaconInterceptor, page }) => {
    // Interceptar requests al mock server para capturar beacons
    const firedBeacons: string[] = []
    await page.route(`${MOCK_VAST_URL}/track/**`, async (route) => {
      firedBeacons.push(route.request().url())
      await route.fulfill({ status: 200, body: '' })
    })

    await player.goto({
      type: 'media',
      src: Streams.hls.vodShort,
      autoplay: true,
      ads: { map: `${MOCK_VAST_URL}/vast/preroll` },
    })

    await player.waitForAdStart(20_000)
    expect(await player.isPlayingAd()).toBe(true)

    await player.waitForAdComplete(30_000)

    // Verificar secuencia de beacons
    expect(firedBeacons.some(u => u.includes('/track/impression'))).toBe(true)
    expect(firedBeacons.some(u => u.includes('/track/start'))).toBe(true)
    expect(firedBeacons.some(u => u.includes('/track/firstQuartile'))).toBe(true)
    expect(firedBeacons.some(u => u.includes('/track/midpoint'))).toBe(true)
    expect(firedBeacons.some(u => u.includes('/track/thirdQuartile'))).toBe(true)
    expect(firedBeacons.some(u => u.includes('/track/complete'))).toBe(true)
  })

  test('pre-roll: contenido pausa durante el ad', async ({ player }) => {
    await player.goto({
      type: 'media',
      src: Streams.hls.vodShort,
      autoplay: true,
      ads: { map: `${MOCK_VAST_URL}/vast/preroll` },
    })

    await player.waitForEvent('adsContentPauseRequested', 20_000)
    expect(await player.isPlayingAd()).toBe(true)
  })

  test('pre-roll: contenido resume en la misma posición post-ad', async ({ player }) => {
    await player.goto({
      type: 'media',
      src: Streams.hls.vodShort,
      autoplay: true,
      ads: { map: `${MOCK_VAST_URL}/vast/preroll` },
    })

    await player.waitForAdStart(20_000)
    await player.waitForAllAdsComplete(60_000)

    // Después del ad, el contenido debe estar en ~0s (era pre-roll)
    await player.waitForEvent('adsContentResumeRequested')
    await player.assertCurrentTimeNear(0, 3)
    await player.assertIsPlaying()
  })

  test('VAST vacío: player continúa con contenido sin error', async ({ player }) => {
    await player.goto({
      type: 'media',
      src: Streams.hls.vodShort,
      autoplay: true,
      ads: { map: `${MOCK_VAST_URL}/vast/empty` },
    })

    await player.waitForReady()
    // Sin ads, el contenido debe empezar directamente
    await player.waitForEvent('playing', 15_000)
    await player.assertIsPlaying()
    expect(await player.isPlayingAd()).toBe(false)
  })

  test('VAST error 303: player emite adsError y continúa con contenido', async ({ player }) => {
    await player.goto({
      type: 'media',
      src: Streams.hls.vodShort,
      autoplay: true,
      ads: { map: `${MOCK_VAST_URL}/vast/error-303` },
    })

    // El player puede emitir adsError pero debe continuar
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
  })
})

test.describe('Ad Beacons — Skippable', () => {
  test('ad skippable: botón skip aparece después del skipoffset (5s)', async ({ player, page }) => {
    await player.goto({
      type: 'media',
      src: Streams.hls.vodShort,
      autoplay: true,
      ads: {
        map: `${MOCK_VAST_URL}/vast/preroll-skippable`,
        skipAt: 5,
      },
    })

    await player.waitForAdStart(20_000)

    // Esperar a que pase el skipoffset
    await page.waitForTimeout(6000)

    // El botón de skip debe estar visible
    const skipButton = page.locator('[data-testid="skip-ad"], .skip-ad, [class*="skip"]')
    await expect(skipButton).toBeVisible({ timeout: 5000 })
  })
})

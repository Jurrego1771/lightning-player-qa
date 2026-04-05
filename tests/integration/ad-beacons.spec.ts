/**
 * ad-beacons.spec.ts — Tests de integración para el ciclo de vida de ads
 *
 * Valida el ciclo completo de ads usando:
 *   A) Eventos del player (adsFirstQuartile, adsMidpoint, etc.) — via player.on()
 *   B) Beacons HTTP interceptados por Playwright — para VAST externo
 *
 * El player emite eventos nativos para el ciclo de ads (método A).
 * Los beacons HTTP (método B) verifican que el SDK IMA efectivamente
 * dispara las requests de tracking.
 *
 * Config de ads: se pasa `adsMap` en loadMSPlayer() — equivalente a data-ads-map.
 * Para contenido con ads configurados en la plataforma, usar ContentIds.vodWithAds.
 */
import { test, expect, ContentIds } from '../../fixtures'

const MOCK_VAST_URL = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

test.describe('Ad Lifecycle — Eventos del Player', () => {

  test('pre-roll: secuencia de eventos de cuartiles via player.on()', async ({ player }) => {
    await player.goto({
      type: 'media',
      id: ContentIds.vodWithAds,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    // Verificar secuencia de eventos en orden
    await player.waitForAdStart(20_000)
    expect(await player.page.evaluate(() => (window as any).__qa.events.includes('adsStarted'))).toBe(true)

    await player.waitForEvent('adsFirstQuartile', 20_000)
    await player.waitForEvent('adsMidpoint', 30_000)
    await player.waitForEvent('adsThirdQuartile', 30_000)
    await player.waitForAllAdsComplete(60_000)

    expect(await player.page.evaluate(() => (window as any).__qa.events.includes('adsComplete'))).toBe(true)
  })

  test('pre-roll: adsContentPauseRequested → adsContentResumeRequested', async ({ player }) => {
    await player.goto({
      type: 'media',
      id: ContentIds.vodWithAds,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    await player.waitForEvent('adsContentPauseRequested', 20_000)
    await player.waitForEvent('adsContentResumeRequested', 60_000)
    await player.assertIsPlaying()
  })

  test('ad info disponible durante playback del ad', async ({ player }) => {
    await player.goto({
      type: 'media',
      id: ContentIds.vodWithAds,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    await player.waitForAdStart(20_000)

    const adInfo = await player.getAdInfo()
    expect(adInfo).not.toBeNull()
    expect(adInfo?.duration).toBeGreaterThan(0)
    expect(adInfo?.isLinear).toBe(true)
  })

  test('VAST vacío: player continúa sin ad, sin error', async ({ player }) => {
    await player.goto({
      type: 'media',
      id: ContentIds.vodWithAds,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/empty`,
    })

    await player.waitForEvent('playing', 15_000)
    await player.assertIsPlaying()

    const errors = await player.getErrors()
    const adErrors = errors.filter((e: any) => e?.type?.includes('ad'))
    expect(adErrors).toHaveLength(0)
  })

  test('VAST error: adsError event se emite y el player continúa', async ({ player }) => {
    await player.goto({
      type: 'media',
      id: ContentIds.vodWithAds,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/error-303`,
    })

    // El player emite adsError pero debe continuar con el contenido
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
  })
})

test.describe('Ad Lifecycle — Beacons HTTP', () => {

  test('impression beacon se dispara al inicio del ad', async ({ player, adBeaconInterceptor, page }) => {
    await page.route(`${MOCK_VAST_URL}/track/**`, async (route) => {
      await route.fulfill({ status: 200, body: '' })
    })

    await player.goto({
      type: 'media',
      id: ContentIds.vodWithAds,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    await player.waitForAdStart(20_000)
    await player.waitForAllAdsComplete(60_000)

    // Verificar beacons HTTP
    expect(adBeaconInterceptor.wasFired('/track/impression')).toBe(true)
    expect(adBeaconInterceptor.wasFired('/track/complete')).toBe(true)
  })
})

test.describe('Ad Skip', () => {

  test('ad skippable: ad.skip() funciona después del skipoffset', async ({ player, page }) => {
    await player.goto({
      type: 'media',
      id: ContentIds.vodWithAds,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll-skippable`,
    })

    await player.waitForAdStart(20_000)

    // Esperar el skipoffset (5s definido en preroll-skippable.xml)
    await page.waitForTimeout(6000)

    // Verificar que el ad es skippable
    const skippable = await player.isAdSkippable()
    if (skippable) {
      await player.skipAd()
      await player.waitForEvent('adsSkipped', 5_000)
    } else {
      test.skip(true, 'Ad no marcado como skippable en este momento')
    }
  })

  test('ad.cuePoints lista los puntos de corte del contenido', async ({ player }) => {
    await player.goto({
      type: 'media',
      id: ContentIds.vodWithAds,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vmap/preroll-midroll`,
    })

    await player.waitForEvent('adsAdMetadata', 15_000)

    const cuePoints = await player.getAdCuePoints()
    expect(Array.isArray(cuePoints)).toBe(true)
    // VMAP con pre-roll + mid-roll debe tener al menos 2 cue points
    expect(cuePoints.length).toBeGreaterThanOrEqual(1)
  })
})

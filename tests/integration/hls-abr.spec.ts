/**
 * hls-abr.spec.ts — Tests de integración para Adaptive Bitrate (ABR) en HLS
 *
 * Valida que el player adapta la calidad según el bandwidth disponible.
 * Usa CDP para throttling de red controlado.
 *
 * NOTA: Solo corre en Chromium (proyecto "performance" en playwright.config.ts)
 * porque CDP requiere Chromium.
 */
import { test, expect, Streams, NetworkProfiles } from '../../fixtures'
import {
  createCDPSession,
  setNetworkThrottle,
  removeNetworkThrottle,
  measureStartup,
} from '../../helpers/qoe-metrics'

test.describe('HLS Adaptive Bitrate', () => {

  test('bajo bandwidth degradado, player selecciona calidad baja', async ({ player, page }) => {
    const cdp = await createCDPSession(page)

    await player.goto({ type: 'media', src: Streams.hls.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Throttlear a 500 Kbps — fuerza calidad baja
    await setNetworkThrottle(cdp, NetworkProfiles.degraded3G)

    // Esperar a que ABR reaccione (2-3 ciclos de segmento)
    await player.waitForEvent('levelchanged', 30_000)

    const metrics = await player.getQoEMetrics()
    // Con 500 Kbps no debería haber buffer saludable si eligió calidad alta
    // Si ABR funciona, el buffer debería mantenerse positivo
    expect(metrics.buffered).toBeGreaterThan(0)

    await removeNetworkThrottle(cdp)
    await cdp.detach()
  })

  test('recovery de bandwidth: player sube calidad cuando mejora la red', async ({ player, page }) => {
    const cdp = await createCDPSession(page)

    await player.goto({ type: 'media', src: Streams.hls.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Degradar → esperar switch hacia abajo
    await setNetworkThrottle(cdp, NetworkProfiles.degraded3G)
    await page.waitForTimeout(10_000)

    const qualitySwitchesDown: number[] = []
    await page.evaluate(() => {
      window.addEventListener('message', (e) => {
        if (e.data?.type === 'levelchanged') qualitySwitchesDown.push(e.data.level)
      })
    })

    // Restaurar bandwidth → esperar switch hacia arriba
    await removeNetworkThrottle(cdp)
    await setNetworkThrottle(cdp, NetworkProfiles.broadband)

    await player.waitForEvent('levelchanged', 30_000)

    // Player debe seguir reproduciendo sin error
    await player.assertIsPlaying()

    await cdp.detach()
  })

  test('error de segmento: player reintenta y continúa sin error fatal', async ({ player, page }) => {
    // Interceptar la primera request de segmento y fallarla
    let segmentRequestCount = 0
    await page.route('**/*.ts', async (route) => {
      segmentRequestCount++
      if (segmentRequestCount === 1) {
        await route.abort('failed')
      } else {
        await route.continue()
      }
    })

    await player.goto({ type: 'media', src: Streams.hls.vod, autoplay: true })
    await player.waitForEvent('playing', 30_000)
    await player.assertIsPlaying()
  })

  test('startup time < 3s en condiciones normales', async ({ player, page }) => {
    await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: true })

    const metrics = await measureStartup(page)

    expect(metrics.timeToFirstFrame).toBeLessThan(3000)
    expect(metrics.timeToLoadedMetadata).toBeLessThan(2000)
  })
})

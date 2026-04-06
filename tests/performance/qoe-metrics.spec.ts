/**
 * qoe-metrics.spec.ts — Tests de Performance y Quality of Experience
 *
 * Mide métricas cuantificables con thresholds definidos por la industria.
 * Corre solo en Chromium (proyecto "performance") porque usa CDP.
 *
 * Thresholds basados en:
 * - Netflix: startup < 2s en broadband
 * - industria: buffering ratio < 0.5%
 * - Google Web Vitals: LCP proxy para players
 */
import { test, expect, Streams, NetworkProfiles } from '../../fixtures'
import {
  measureStartup,
  PlaybackMetricsCollector,
  createCDPSession,
  setNetworkThrottle,
} from '../../helpers/qoe-metrics'

// Thresholds — ajustar según SLAs del producto
const THRESHOLDS = {
  startupMs: 3000,           // 3s máximo en broadband
  loadedMetadataMs: 2000,    // 2s para loadedmetadata
  bufferingRatio: 0.005,     // 0.5% máximo
  droppedFrameRatio: 0.01,   // 1% máximo
  seekLatencyMs: 2000,       // 2s máximo seek-to-playing
  minBufferHealthSec: 5,     // 5s mínimo de buffer forward
}

test.describe('QoE — Startup', () => {

  test('startup time < 3s en broadband (HLS VOD)', async ({ player, page }) => {
    await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: true })
    const metrics = await measureStartup(page)

    expect(metrics.timeToFirstFrame).toBeLessThan(THRESHOLDS.startupMs)
    expect(metrics.timeToLoadedMetadata).toBeLessThan(THRESHOLDS.loadedMetadataMs)

    console.log('Startup metrics:', metrics)
  })

  test('startup time < 3s en broadband (DASH VOD)', async ({ player, page }) => {
    await player.goto({ type: 'media', src: Streams.dash.vod, autoplay: true })
    const metrics = await measureStartup(page)

    expect(metrics.timeToFirstFrame).toBeLessThan(THRESHOLDS.startupMs)
    console.log('DASH Startup metrics:', metrics)
  })
})

test.describe('QoE — Buffer Health', () => {

  test('buffer forward ≥ 5s después de 3s de reproducción normal', async ({ player }) => {
    await player.goto({ type: 'media', src: Streams.hls.vod, autoplay: true })
    await player.waitForEvent('playing')
    await player.page.waitForTimeout(3000)

    await player.assertBufferHealthAbove(THRESHOLDS.minBufferHealthSec)
  })

  test('buffer se mantiene bajo bandwidth degradado 3G', async ({ player, page }) => {
    const cdp = await createCDPSession(page)
    await setNetworkThrottle(cdp, NetworkProfiles.degraded3G)

    await player.goto({ type: 'media', src: Streams.hls.vod, autoplay: true })
    await player.waitForEvent('playing', 30_000)
    await page.waitForTimeout(5000)

    // Bajo 500 Kbps, el buffer puede ser menor, pero debe ser positivo
    const metrics = await player.getQoEMetrics()
    expect(metrics.bufferedAhead).toBeGreaterThan(0)

    await cdp.detach()
  })
})

test.describe('QoE — Sesión Completa', () => {

  test('buffering ratio < 0.5% en 30s de reproducción normal', async ({ player, page }) => {
    const collector = new PlaybackMetricsCollector()

    await player.goto({ type: 'media', src: Streams.hls.vod, autoplay: true })
    await player.waitForEvent('playing')
    await collector.startCollecting(page)

    // Reproducir por 30 segundos
    await page.waitForTimeout(30_000)

    const metrics = await collector.collectFinal(page)

    expect(metrics.bufferingRatio).toBeLessThan(THRESHOLDS.bufferingRatio)
    expect(metrics.droppedFrameRatio).toBeLessThan(THRESHOLDS.droppedFrameRatio)

    console.log('Session metrics:', {
      ...metrics,
      bufferingRatioPct: (metrics.bufferingRatio * 100).toFixed(2) + '%',
      droppedFrameRatioPct: (metrics.droppedFrameRatio * 100).toFixed(2) + '%',
    })
  })
})

test.describe('QoE — Seek Latency', () => {

  test('seek latency < 2s (tiempo de seeking → playing)', async ({ player, page }) => {
    await player.goto({ type: 'media', src: Streams.hls.vod, autoplay: true })
    await player.waitForEvent('playing')

    const seekStart = Date.now()
    await player.seek(60) // Seek a los 60s

    await player.waitForEvent('seeked')
    await player.waitForEvent('playing')
    const seekLatency = Date.now() - seekStart

    expect(seekLatency).toBeLessThan(THRESHOLDS.seekLatencyMs)
    console.log(`Seek latency: ${seekLatency}ms`)
  })
})

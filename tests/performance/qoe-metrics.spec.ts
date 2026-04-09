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
 *
 * Trend tracking:
 * Las métricas se guardan en perf-results/current-run.json (gitignored).
 * Después del run: npm run perf:compare   → detecta regresiones vs baseline
 *                  npm run perf:update-baseline → actualiza el baseline si el run fue bueno
 */
import { test, expect, Streams, NetworkProfiles } from '../../fixtures'
import {
  measureStartup,
  PlaybackMetricsCollector,
  createCDPSession,
  setNetworkThrottle,
} from '../../helpers/qoe-metrics'
import { PerfStorage } from '../../helpers/perf-storage'

// Thresholds — ajustar según SLAs del producto
const THRESHOLDS = {
  startupMs: 3000,           // 3s máximo en broadband
  loadedMetadataMs: 2000,    // 2s para loadedmetadata
  bufferingRatio: 0.005,     // 0.5% máximo
  droppedFrameRatio: 0.01,   // 1% máximo
  seekLatencyMs: 2000,       // 2s máximo seek-to-playing
  minBufferHealthSec: 5,     // 5s mínimo de buffer forward
}

test.describe('QoE — Startup', { tag: ['@performance'] }, () => {

  test('startup time < 3s en broadband (HLS VOD)', async ({ player, page }) => {
    test.skip(process.env.STREAM_HLS_VOD_SHORT_OK !== 'true', 'Streams.hls.vodShort no disponible')
    await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: true })
    const metrics = await measureStartup(page)

    expect(metrics.timeToFirstFrame).toBeLessThan(THRESHOLDS.startupMs)
    expect(metrics.timeToLoadedMetadata).toBeLessThan(THRESHOLDS.loadedMetadataMs)

    PerfStorage.record('startup_hls', {
      timeToFirstFrame_ms:    metrics.timeToFirstFrame,
      timeToLoadedMetadata_ms: metrics.timeToLoadedMetadata,
      timeToCanPlay_ms:       metrics.timeToCanPlay,
    })

    console.log('Startup metrics:', metrics)
  })

  test('startup time < 3s en broadband (DASH VOD — playback nativo)', async ({ player, page }) => {
    test.skip(process.env.STREAM_DASH_VOD_OK !== 'true', 'Streams.dash.vod no disponible')

    // IMPORTANTE: El player NO usa dash.js. DASH se reproduce via el elemento
    // <video> nativo del browser. Este test valida únicamente que el browser
    // puede iniciar reproducción de un stream DASH — no valida ABR ni propiedades
    // del player como level/levels/bandwidth (no disponibles para DASH).
    await player.goto({ type: 'media', src: Streams.dash.vod, autoplay: true })
    const metrics = await measureStartup(page)

    expect(metrics.timeToFirstFrame).toBeLessThan(THRESHOLDS.startupMs)

    PerfStorage.record('startup_dash_native', {
      timeToFirstFrame_ms: metrics.timeToFirstFrame,
    })

    console.log('DASH (native) startup metrics:', metrics)
  })
})

test.describe('QoE — Buffer Health', { tag: ['@performance'] }, () => {

  test('buffer forward ≥ 5s después de 3s de reproducción normal', async ({ player }) => {
    test.skip(process.env.STREAM_HLS_VOD_OK !== 'true', 'Streams.hls.vod no disponible')
    await player.goto({ type: 'media', src: Streams.hls.vod, autoplay: true })
    await player.waitForEvent('playing')

    // Capturar el valor real mientras se espera al threshold.
    let bufferedAhead = 0
    await expect.poll(async () => {
      const m = await player.getQoEMetrics()
      bufferedAhead = m.bufferedAhead
      return bufferedAhead
    }, { timeout: 15_000, intervals: [500] }).toBeGreaterThanOrEqual(THRESHOLDS.minBufferHealthSec)

    PerfStorage.record('buffer_health', {
      bufferedAhead_sec: bufferedAhead,
    })
  })

  test('buffer se mantiene bajo bandwidth degradado 3G', async ({ player, page }) => {
    test.skip(process.env.STREAM_HLS_VOD_OK !== 'true', 'Streams.hls.vod no disponible')
    const cdp = await createCDPSession(page)
    await setNetworkThrottle(cdp, NetworkProfiles.degraded3G)

    await player.goto({ type: 'media', src: Streams.hls.vod, autoplay: true })
    await player.waitForEvent('playing', 30_000)

    // Bajo 500 Kbps el buffer tarda más en poblarse — poll hasta que sea positivo.
    let bufferedAheadDegraded = 0
    await expect.poll(async () => {
      const m = await player.getQoEMetrics()
      bufferedAheadDegraded = m.bufferedAhead
      return bufferedAheadDegraded
    }, { timeout: 20_000, intervals: [500] }).toBeGreaterThan(0)

    PerfStorage.record('buffer_health_degraded_3g', {
      bufferedAhead_sec: bufferedAheadDegraded,
    })

    await cdp.detach()
  })
})

test.describe('QoE — Sesión Completa', { tag: ['@performance', '@slow'] }, () => {

  test('buffering ratio < 0.5% en 30s de reproducción normal', async ({ player, page }) => {
    test.skip(process.env.STREAM_HLS_VOD_OK !== 'true', 'Streams.hls.vod no disponible')
    const collector = new PlaybackMetricsCollector()

    await player.goto({ type: 'media', src: Streams.hls.vod, autoplay: true })
    await player.waitForEvent('playing')
    await collector.startCollecting(page)

    // Reproducir por 30 segundos — waitForTimeout intencional aquí.
    // Este test mide el buffering ratio durante una ventana de tiempo definida.
    // No hay evento que sustituya la duración: el propósito ES esperar 30s.
    await page.waitForTimeout(30_000)

    const metrics = await collector.collectFinal(page)

    expect(metrics.bufferingRatio).toBeLessThan(THRESHOLDS.bufferingRatio)
    expect(metrics.droppedFrameRatio).toBeLessThan(THRESHOLDS.droppedFrameRatio)

    PerfStorage.record('session_30s', {
      bufferingRatio:    metrics.bufferingRatio,
      droppedFrameRatio: metrics.droppedFrameRatio,
      qualitySwitches:   metrics.qualitySwitches,
      averageBitrate:    metrics.averageBitrate,
    })

    console.log('Session metrics:', {
      ...metrics,
      bufferingRatioPct:    (metrics.bufferingRatio * 100).toFixed(2) + '%',
      droppedFrameRatioPct: (metrics.droppedFrameRatio * 100).toFixed(2) + '%',
    })
  })
})

test.describe('QoE — Seek Latency', { tag: ['@performance'] }, () => {

  test('seek latency < 2s (tiempo de seeking → playing)', async ({ player, page }) => {
    test.skip(process.env.STREAM_HLS_VOD_OK !== 'true', 'Streams.hls.vod no disponible')
    await player.goto({ type: 'media', src: Streams.hls.vod, autoplay: true })
    await player.waitForEvent('playing')

    const seekStart = Date.now()
    await player.seek(60)

    await player.waitForEvent('seeked')
    await player.waitForEvent('playing')
    const seekLatency = Date.now() - seekStart

    expect(seekLatency).toBeLessThan(THRESHOLDS.seekLatencyMs)

    PerfStorage.record('seek_latency', {
      seekLatency_ms: seekLatency,
    })

    console.log(`Seek latency: ${seekLatency}ms`)
  })
})

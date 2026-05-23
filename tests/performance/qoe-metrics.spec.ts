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
import { test, expect, ContentIds, NetworkProfiles } from '../../fixtures'
import {
  measureStartup,
  PlaybackMetricsCollector,
  createCDPSession,
  setNetworkThrottle,
} from '../../helpers/qoe-metrics'
import { PerfStorage } from '../../helpers/perf-storage'

// Thresholds — baselines reales (dev CDN) + 25% headroom para variance
// Industria (Netflix): startup <2s, buffering <0.1%, seek <2s — nuestros valores reflejan dev CDN lento
const THRESHOLDS = {
  startupHlsMs: 4500,        // Baseline: 3659ms. 25% headroom. Industry: 2000ms.
  startupDashMs: 3000,       // Baseline: 2281ms. DASH nativo es más rápido.
  loadedMetadataMs: 2000,    // 2s para loadedmetadata
  bufferingRatio: 0.001,     // 0.1% — industria Netflix/YouTube. Baseline: 0%.
  droppedFrameRatio: 0.005,  // 0.5% — industria estándar. Baseline: 0%.
  seekLatencyMs: 15_000,     // Dev CDN baseline: 10640ms. Detector de regresión; perf:compare maneja el SLA.
  minBufferHealthSec: 10,    // 10s mínimo. Baseline muestra 30s en broadband.
}

test.describe('QoE — Startup', { tag: ['@performance'] }, () => {

  test('startup time < 4.5s en broadband (HLS VOD)', async ({ player, page }) => {
    // Record playerInitT0 inside the beforeInit hook — fired right before loadMSPlayer()
    // is called (after the player script has loaded). This measures "time from
    // loadMSPlayer() call to first playing frame", excluding test infrastructure
    // overhead (script download). That is the true player startup latency.
    let playerInitT0 = 0
    await player.goto(
      { type: 'media', id: ContentIds.vodShort, autoplay: true },
      { beforeInit: async () => { playerInitT0 = Date.now() } }
    )
    const metrics = await measureStartup(page, playerInitT0)

    // Both bounds required: > 0 catches a broken measurement (returns 0 or negative),
    // < threshold catches a real performance regression.
    expect(
      metrics.timeToFirstFrame,
      'timeToFirstFrame must be a real positive measurement — 0 indicates the player never reached currentTime > 0'
    ).toBeGreaterThan(0)
    expect(metrics.timeToFirstFrame).toBeLessThan(THRESHOLDS.startupHlsMs)

    // timeToLoadedMetadata and timeToCanPlay are -1 by design (one-time events fired
    // before measureStartup() ran). Do not assert on -1 sentinels.
    PerfStorage.record('startup_hls', {
      timeToFirstFrame_ms:     metrics.timeToFirstFrame,
      timeToLoadedMetadata_ms: metrics.timeToLoadedMetadata,  // -1: measurement gap — see measureStartup() JSDoc
      timeToCanPlay_ms:        metrics.timeToCanPlay,          // -1: measurement gap — see measureStartup() JSDoc
    })

    console.log('Startup metrics (HLS VOD):', metrics)
  })

  test('startup time < 3s en broadband (DASH VOD — playback nativo)', async ({ player, page }) => {
    // DASH usa playback nativo del browser (no dash.js). Sin ABR controlable.
    // DASH se reproduce via el elemento <video> nativo del browser.
    // Este test valida que el browser puede iniciar reproducción de un stream DASH.
    // No valida ABR ni propiedades HLS-only (level/levels/bandwidth).
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: true })
    const metrics = await measureStartup(page)

    expect(metrics.timeToFirstFrame).toBeGreaterThan(0)
    expect(metrics.timeToFirstFrame).toBeLessThan(THRESHOLDS.startupDashMs)

    PerfStorage.record('startup_dash_native', {
      timeToFirstFrame_ms: metrics.timeToFirstFrame,
    })

    console.log('DASH (native) startup metrics:', metrics)
  })
})

test.describe('QoE — Buffer Health', { tag: ['@performance'] }, () => {

  test('buffer forward ≥ 5s después de 3s de reproducción normal', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing')
    // Poll video.readyState directly on the HTML element (bypasses __qa.events backfill which
    // can resolve immediately from harness backfill even before the video element is ready).
    await player.waitForVideoReadyState(1, 20_000)

    // Capturar el valor real mientras se espera al threshold.
    let bufferedAhead = 0
    await expect.poll(async () => {
      const m = await player.getQoEMetrics()
      bufferedAhead = m.bufferedAhead
      return bufferedAhead
    }, { timeout: 20_000, intervals: [500] }).toBeGreaterThanOrEqual(THRESHOLDS.minBufferHealthSec)

    PerfStorage.record('buffer_health', {
      bufferedAhead_sec: bufferedAhead,
    })
  })

  test('buffer se mantiene bajo bandwidth degradado 3G', async ({ player, page }) => {
    // Apply CDP throttle via beforeInit so the player SCRIPT loads at full speed.
    // Without this, the player's api.js (~200-400 KB) would download at 62.5 KB/s,
    // adding 3-6s to script load time and making the 30s playing timeout flaky.
    // Only media segments are throttled — this isolates ABR behavior.
    let cdp: import('@playwright/test').CDPSession
    await player.goto(
      { type: 'media', id: ContentIds.vodLong, autoplay: true },
      {
        beforeInit: async () => {
          cdp = await createCDPSession(page)
          await setNetworkThrottle(cdp, NetworkProfiles.degraded3G)
        },
      }
    )
    await player.waitForEvent('playing', 30_000)

    // Meaningful threshold: 1s of forward buffer under 3G is a real quality bar.
    // The previous threshold (> 0) was trivially achievable with a single buffered frame
    // and provided no signal about ABR behavior under constrained bandwidth.
    let bufferedAheadDegraded = 0
    await expect.poll(async () => {
      const m = await player.getQoEMetrics()
      bufferedAheadDegraded = m.bufferedAhead
      return bufferedAheadDegraded
    }, { timeout: 30_000, intervals: [500] }).toBeGreaterThan(1.0)

    PerfStorage.record('buffer_health_degraded_3g', {
      bufferedAhead_sec: bufferedAheadDegraded,
    })

    await cdp!.detach()
  })
})

test.describe('QoE — Sesión Completa', { tag: ['@performance', '@slow'] }, () => {

  test('buffering ratio < 0.5% en 30s de reproducción normal', async ({ player, page }) => {
    const collector = new PlaybackMetricsCollector()

    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing')
    await collector.startCollecting(page)

    // Reproducir por 30 segundos — waitForTimeout intencional aquí.
    // Este test mide el buffering ratio durante una ventana de tiempo definida.
    // No hay evento que sustituya la duración: el propósito ES esperar 30s.
    await page.waitForTimeout(30_000)

    const metrics = await collector.collectFinal(page)

    // Guard: totalPlayTime must reflect the actual 30s window. If it is near 0,
    // the bufferingRatio computation (totalStallMs / totalPlayTime) is meaningless.
    expect(
      metrics.totalPlayTime,
      'totalPlayTime must reflect the 30s observation window (expected > 25s)'
    ).toBeGreaterThan(25_000)
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

  test('seek latency medido y dentro de 15s (dev CDN baseline: 10.6s)', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing')

    // Flush seek-related events from __qa.events BEFORE the seek so that
    // waitForEvent() cannot match pre-seek entries. Without this flush,
    // waitForEvent('playing') uses array.includes() which returns true immediately
    // because 'playing' from the initial autoplay is already in the array.
    // A stale match produces seekLatency ~0ms, which always passes the 2s threshold
    // while measuring nothing about actual seek performance.
    await page.evaluate(() => {
      ;(window as any).__qa.events = ((window as any).__qa.events as string[]).filter(
        (e) => e !== 'seeking' && e !== 'seeked' && e !== 'playing'
      )
    })

    const seekStart = Date.now()
    await player.seek(60)

    // These waitForEvent calls now resolve only on the post-seek events because
    // the pre-seek entries were removed above.
    await player.waitForEvent('seeked', 25_000)
    await player.waitForEvent('playing', 25_000)
    const seekLatency = Date.now() - seekStart

    // Record before assertions so the value is captured even if the threshold assertion
    // fails (e.g. dev CDN cold-start). perf:compare uses the recorded value, not test pass/fail.
    PerfStorage.record('seek_latency', {
      seekLatency_ms: seekLatency,
    })

    // Lower bound: a real seek + buffer-refill + playing sequence takes at minimum
    // tens of milliseconds. A value near 0ms indicates a stale event match (the flush
    // above did not work or was not awaited before the seek fired events).
    expect(
      seekLatency,
      'seek latency must be a positive real measurement — value near 0 indicates a stale event match'
    ).toBeGreaterThan(10)
    expect(seekLatency).toBeLessThan(THRESHOLDS.seekLatencyMs)

    // Confirm the seek actually reached the target position — a silent seek failure
    // (player stays at currentTime 0) would still fire seeked + playing events.
    await player.assertCurrentTimeNear(60, 3)

    console.log(`Seek latency: ${seekLatency}ms`)
  })
})

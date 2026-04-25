/**
 * qoe-metrics.ts — Helpers para medir Quality of Experience
 *
 * Usa Chrome DevTools Protocol (CDP) via Playwright para acceder
 * a métricas de red y rendimiento a nivel de browser.
 *
 * NOTA: CDP solo disponible en Chromium. Los tests de performance
 * deben correr en el proyecto "performance" del playwright.config.ts.
 */
import { Page, CDPSession } from '@playwright/test'

export interface NetworkThrottle {
  downloadThroughput: number // bytes/s
  uploadThroughput: number   // bytes/s
  latency: number            // ms RTT
}

export interface StartupMetrics {
  timeToLoadedMetadata: number  // ms
  timeToCanPlay: number          // ms
  timeToFirstFrame: number       // ms
  drmAcquisitionTime?: number    // ms (solo para contenido DRM)
}

export interface PlaybackSessionMetrics {
  totalPlayTime: number      // ms
  totalStallTime: number     // ms
  bufferingRatio: number     // 0-1
  qualitySwitches: number
  averageBitrate: number     // bps
  droppedFrameRatio: number  // 0-1
}

// ── CDP Network Throttling ────────────────────────────────────────────────

export async function createCDPSession(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page)
}

export async function setNetworkThrottle(
  cdp: CDPSession,
  profile: NetworkThrottle
): Promise<void> {
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: profile.downloadThroughput,
    uploadThroughput: profile.uploadThroughput,
    latency: profile.latency,
  })
}

export async function removeNetworkThrottle(cdp: CDPSession): Promise<void> {
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: -1,
    uploadThroughput: -1,
    latency: 0,
  })
}

// ── Startup Time Measurement ──────────────────────────────────────────────

/**
 * Measures wall-clock startup time from before player initialization to first
 * playing frame. MUST be called after player.goto() returns — which means
 * HTMLMediaElement one-time events (loadedmetadata, canplay) have already fired.
 *
 * @param page  - Playwright Page
 * @param wallT0 - Date.now() recorded in the test BEFORE player.goto() was called.
 *                 Used to compute timeToFirstFrame as total wall-clock elapsed.
 *                 If omitted, only currentTime-polling is used (less accurate).
 *
 * Returns:
 *   timeToFirstFrame    - wall-clock ms from t0 to when currentTime > 0 is confirmed.
 *                         Always > 0 if the player reaches playing state.
 *   timeToLoadedMetadata - always -1 (event already fired before this function runs;
 *                         this is a known limitation — do not assert upper bound on it).
 *   timeToCanPlay        - always -1 (same reason as above).
 *
 * Rationale for -1 on loadedmetadata/canplay: player.goto() does not return until
 * __qa.initialized === true, which means the player is fully initialized and those
 * one-time events have already fired before this function installs listeners.
 * Returning -1 explicitly signals a measurement gap rather than silently passing
 * assertions with a false-positive value.
 */
export async function measureStartup(page: Page, wallT0?: number): Promise<StartupMetrics> {
  const t0Host = wallT0 ?? Date.now()

  // Wait for currentTime > 0 via polling — this works even post-init because
  // currentTime advances continuously during playback. The page.waitForFunction
  // approach is used instead of page.evaluate + rAF loop to avoid blocking the
  // Node.js side while polling inside the browser.
  await page.waitForFunction(
    () => {
      const v = document.querySelector('video') ?? document.querySelector('audio')
      return v !== null && (v as HTMLVideoElement | HTMLAudioElement).currentTime > 0
    },
    { timeout: 10_000, polling: 100 }
  )

  const timeToFirstFrame = Date.now() - t0Host

  return {
    // loadedmetadata and canplay are one-time events that fired before goto() returned.
    // They cannot be measured post-init — return -1 to make the gap explicit.
    timeToLoadedMetadata: -1,
    timeToCanPlay: -1,
    timeToFirstFrame,
  }
}

// ── Session Metrics Collector ─────────────────────────────────────────────

export class PlaybackMetricsCollector {
  private startTime = 0

  async startCollecting(page: Page): Promise<void> {
    this.startTime = Date.now()

    await page.evaluate(() => {
      window.__qaMetrics = {
        stallCount: 0,
        totalStallMs: 0,    // accumulates stall duration in ms
        stallStart: 0,      // timestamp (ms) when the current stall began; 0 = not stalling
        qualitySwitches: 0,
        bitrateReadings: [] as number[],
      }

      const v = document.querySelector('video') ?? document.querySelector('audio')
      if (!v) return

      // 'waiting' fires when the player stalls (buffer underrun or seek buffer refill).
      // Record the start timestamp so we can compute stall duration when playback resumes.
      v.addEventListener('waiting', () => {
        window.__qaMetrics.stallCount++
        window.__qaMetrics.stallStart = Date.now()
      })

      // 'playing' fires when stalled playback resumes. Accumulate elapsed stall time.
      // Note: 'playing' also fires on initial autoplay — guard with stallStart > 0.
      v.addEventListener('playing', () => {
        if (window.__qaMetrics.stallStart > 0) {
          window.__qaMetrics.totalStallMs += Date.now() - window.__qaMetrics.stallStart
          window.__qaMetrics.stallStart = 0
        }
      })

      // 'levelchanged' is a custom player event dispatched via player.on(), NOT a native
      // HTMLMediaElement event. Attaching it to the <video> element will never fire.
      // Quality switches are counted from window.__qa.events in collectFinal() instead,
      // because the harness already records every 'levelchanged' occurrence there.
    })
  }

  async collectFinal(page: Page): Promise<PlaybackSessionMetrics> {
    const totalPlayTime = Date.now() - this.startTime

    const browserMetrics = await page.evaluate(() => {
      const v = document.querySelector('video') ?? document.querySelector('audio')
      const vq = (v as HTMLVideoElement)?.getVideoPlaybackQuality?.()

      // If a stall is still in progress when we collect, finalize it now.
      if (window.__qaMetrics.stallStart > 0) {
        window.__qaMetrics.totalStallMs += Date.now() - window.__qaMetrics.stallStart
        window.__qaMetrics.stallStart = 0
      }

      // Count quality switches from __qa.events — the harness records every
      // 'levelchanged' occurrence via player.on(), which is the correct event source.
      // Each push to __qa.events is one quality switch (unlike 'timeupdate' which is deduped).
      const qualitySwitches = ((window as any).__qa?.events as string[] ?? [])
        .filter((e) => e === 'levelchanged').length

      return {
        droppedFrames: vq?.droppedVideoFrames ?? 0,
        totalFrames: vq?.totalVideoFrames ?? 0,
        totalStallMs: window.__qaMetrics.totalStallMs,
        qualitySwitches,
        bitrateReadings: window.__qaMetrics.bitrateReadings,
      }
    })

    const avgBitrate = browserMetrics.bitrateReadings.length > 0
      ? browserMetrics.bitrateReadings.reduce((a: number, b: number) => a + b, 0) / browserMetrics.bitrateReadings.length
      : 0

    return {
      totalPlayTime,
      totalStallTime: browserMetrics.totalStallMs,
      bufferingRatio: totalPlayTime > 0 ? browserMetrics.totalStallMs / totalPlayTime : 0,
      qualitySwitches: browserMetrics.qualitySwitches,
      averageBitrate: avgBitrate,
      droppedFrameRatio: browserMetrics.totalFrames > 0
        ? browserMetrics.droppedFrames / browserMetrics.totalFrames
        : 0,
    }
  }
}

// Extensión global para TypeScript
declare global {
  interface Window {
    __qaMetrics: {
      stallCount: number
      totalStallMs: number    // accumulated stall duration in ms
      stallStart: number      // timestamp when current stall began; 0 = not stalling
      qualitySwitches: number
      bitrateReadings: number[]
    }
  }
}

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

export async function measureStartup(page: Page): Promise<StartupMetrics> {
  return page.evaluate(() => {
    return new Promise<StartupMetrics>((resolve) => {
      const t0 = performance.now()
      let timeToLoadedMetadata = -1
      let timeToCanPlay = -1

      const v = document.querySelector('video') ?? document.querySelector('audio')
      if (!v) { resolve({ timeToLoadedMetadata: -1, timeToCanPlay: -1, timeToFirstFrame: -1 }); return }

      v.addEventListener('loadedmetadata', () => { timeToLoadedMetadata = performance.now() - t0 }, { once: true })
      v.addEventListener('canplay', () => { timeToCanPlay = performance.now() - t0 }, { once: true })

      // First frame: cuando currentTime deja de ser 0
      const checkFirstFrame = () => {
        if (v.currentTime > 0) {
          resolve({
            timeToLoadedMetadata,
            timeToCanPlay,
            timeToFirstFrame: performance.now() - t0,
          })
        } else {
          requestAnimationFrame(checkFirstFrame)
        }
      }
      requestAnimationFrame(checkFirstFrame)
    })
  })
}

// ── Session Metrics Collector ─────────────────────────────────────────────

export class PlaybackMetricsCollector {
  private startTime = 0
  private stallStart = 0
  private totalStallMs = 0
  private qualitySwitchCount = 0
  private bitrateSum = 0
  private bitrateReadings = 0

  async startCollecting(page: Page): Promise<void> {
    this.startTime = Date.now()

    await page.evaluate(() => {
      window.__qaMetrics = {
        stallCount: 0,
        qualitySwitches: 0,
        bitrateReadings: [] as number[],
      }

      const v = document.querySelector('video') ?? document.querySelector('audio')
      if (!v) return

      v.addEventListener('waiting', () => { window.__qaMetrics.stallCount++ })
      v.addEventListener('levelchanged', (e: Event) => {
        window.__qaMetrics.qualitySwitches++
        const detail = (e as CustomEvent).detail
        if (detail?.bitrate) window.__qaMetrics.bitrateReadings.push(detail.bitrate)
      })
    })
  }

  async collectFinal(page: Page): Promise<PlaybackSessionMetrics> {
    const totalPlayTime = Date.now() - this.startTime

    const browserMetrics = await page.evaluate(() => {
      const v = document.querySelector('video') ?? document.querySelector('audio')
      const vq = (v as HTMLVideoElement)?.getVideoPlaybackQuality?.()
      return {
        droppedFrames: vq?.droppedVideoFrames ?? 0,
        totalFrames: vq?.totalVideoFrames ?? 0,
        ...window.__qaMetrics,
      }
    })

    const avgBitrate = browserMetrics.bitrateReadings.length > 0
      ? browserMetrics.bitrateReadings.reduce((a: number, b: number) => a + b, 0) / browserMetrics.bitrateReadings.length
      : 0

    return {
      totalPlayTime,
      totalStallTime: this.totalStallMs,
      bufferingRatio: totalPlayTime > 0 ? this.totalStallMs / totalPlayTime : 0,
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
      qualitySwitches: number
      bitrateReadings: number[]
    }
  }
}

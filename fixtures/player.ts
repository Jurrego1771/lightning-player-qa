/**
 * LightningPlayerPage — Page Object Model para el Lightning Player
 *
 * Esta clase abstrae TODA la interacción con el player. Los tests nunca
 * acceden al DOM del player directamente; siempre usan esta interfaz.
 *
 * El player expone su API via:
 *   - Métodos globales en window (instancia del player)
 *   - Eventos via window.postMessage con prefijo "msp:"
 *   - El elemento <video>/<audio> del DOM
 *
 * El harness se carga con page.setContent() + addScriptTag() para evitar
 * depender de un servidor local. El script del player viene de CDN.
 */
import * as fs from 'fs'
import * as path from 'path'
import { Page, expect } from '@playwright/test'
import { getEnvironmentConfig } from '../config/environments'

export type PlayerStatus = 'playing' | 'pause' | 'buffering' | 'idle'
export type PlayerType = 'live' | 'dvr' | 'media' | 'audio' | 'radio' | 'reels' | 'podcast'
export type PlayerView = 'lightning' | 'audio' | 'radio' | 'podcast' | 'reels' | 'compact' | 'none'

export interface PlayerConfig {
  type: PlayerType
  src?: string
  id?: string
  autoplay?: boolean
  controls?: boolean
  volume?: number
  view?: PlayerView
  ads?: {
    map?: string
    skipAt?: number
  }
  startPos?: number
  [key: string]: unknown
}

export interface QoEMetrics {
  currentTime: number
  duration: number
  buffered: number         // segundos de buffer hacia adelante
  droppedFrames: number
  totalFrames: number
  readyState: number
}

export class LightningPlayerPage {
  constructor(private readonly page: Page) {}

  // ── Navegación ────────────────────────────────────────────────────────────

  /**
   * Carga el harness HTML + script del player y lo inicializa con la config dada.
   *
   * Estrategia: usa page.setContent() para no depender de un servidor local.
   * El script del player se carga desde CDN según el ambiente activo (PLAYER_ENV).
   *
   * Ambientes:
   *   dev     → develop/api.js  (default, pruebas diarias)
   *   staging → staging/api.js  (smoke post-deploy)
   *   prod    → api.js          (smoke post-deploy prod)
   */
  async goto(config: PlayerConfig): Promise<void> {
    const envConfig = getEnvironmentConfig()
    const harnessPath = path.join(__dirname, '..', 'harness', 'index.html')
    const harnessHtml = fs.readFileSync(harnessPath, 'utf-8')

    // Cargar el HTML del harness
    await this.page.setContent(harnessHtml, { waitUntil: 'domcontentloaded' })

    // Inyectar el script del player desde CDN según el ambiente
    await this.page.addScriptTag({ url: envConfig.playerScriptUrl })

    // Inicializar el player con la config
    await this.page.evaluate((cfg) => {
      window.__initPlayer(cfg)
    }, config as Record<string, unknown>)
  }

  // ── Estado del Player ─────────────────────────────────────────────────────

  async waitForReady(timeout = 30_000): Promise<void> {
    await this.page.waitForFunction(
      () => window.__lightningPlayer?.ready === true,
      { timeout }
    )
  }

  async waitForEvent(eventName: string, timeout = 15_000): Promise<void> {
    await this.page.waitForFunction(
      (name) => window.__lightningPlayerEvents?.includes(name),
      eventName,
      { timeout }
    )
  }

  async getStatus(): Promise<PlayerStatus> {
    return this.page.evaluate(() => window.__lightningPlayer?.getStatus?.() ?? 'idle')
  }

  async isPlayingAd(): Promise<boolean> {
    return this.page.evaluate(() => window.__lightningPlayer?.isPlayingAd?.() ?? false)
  }

  // ── Controles de Playback ─────────────────────────────────────────────────

  async play(): Promise<void> {
    await this.page.evaluate(() => window.__lightningPlayer?.play())
  }

  async pause(): Promise<void> {
    await this.page.evaluate(() => window.__lightningPlayer?.pause())
  }

  async seek(seconds: number): Promise<void> {
    await this.page.evaluate((t) => { window.__lightningPlayer.currentTime = t }, seconds)
  }

  async getCurrentTime(): Promise<number> {
    return this.page.evaluate(() => window.__lightningPlayer?.currentTime ?? 0)
  }

  async getDuration(): Promise<number> {
    return this.page.evaluate(() => window.__lightningPlayer?.duration ?? 0)
  }

  async setVolume(value: number): Promise<void> {
    await this.page.evaluate((v) => { window.__lightningPlayer.volume = v }, value)
  }

  async getVolume(): Promise<number> {
    return this.page.evaluate(() => window.__lightningPlayer?.volume ?? 1)
  }

  // ── Métricas QoE ──────────────────────────────────────────────────────────

  async getQoEMetrics(): Promise<QoEMetrics> {
    return this.page.evaluate(() => {
      const video = document.querySelector('video') ?? document.querySelector('audio')
      if (!video) throw new Error('No media element found')
      const vq = (video as HTMLVideoElement).getVideoPlaybackQuality?.()
      return {
        currentTime: video.currentTime,
        duration: video.duration,
        buffered: video.buffered.length > 0
          ? video.buffered.end(video.buffered.length - 1) - video.currentTime
          : 0,
        droppedFrames: vq?.droppedVideoFrames ?? 0,
        totalFrames: vq?.totalVideoFrames ?? 0,
        readyState: video.readyState,
      }
    })
  }

  async measureStartupTime(): Promise<number> {
    return this.page.evaluate(() => {
      return new Promise<number>((resolve) => {
        const start = performance.now()
        const video = document.querySelector('video') ?? document.querySelector('audio')
        if (!video) { resolve(-1); return }
        if (video.currentTime > 0) { resolve(performance.now() - start); return }
        const check = () => {
          if (video.currentTime > 0) {
            resolve(performance.now() - start)
          } else {
            requestAnimationFrame(check)
          }
        }
        requestAnimationFrame(check)
      })
    })
  }

  // ── Anuncios ──────────────────────────────────────────────────────────────

  async waitForAdStart(timeout = 20_000): Promise<void> {
    await this.waitForEvent('adsStarted', timeout)
  }

  async waitForAdComplete(timeout = 60_000): Promise<void> {
    await this.waitForEvent('adsComplete', timeout)
  }

  async waitForAllAdsComplete(timeout = 120_000): Promise<void> {
    await this.waitForEvent('adsAllAdsCompleted', timeout)
  }

  // ── Aserciones Comunes ────────────────────────────────────────────────────

  async assertIsPlaying(): Promise<void> {
    await expect.poll(() => this.getStatus(), { timeout: 10_000 }).toBe('playing')
  }

  async assertIsPaused(): Promise<void> {
    await expect.poll(() => this.getStatus(), { timeout: 10_000 }).toBe('pause')
  }

  async assertCurrentTimeNear(expected: number, toleranceSeconds = 1): Promise<void> {
    const actual = await this.getCurrentTime()
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(toleranceSeconds)
  }

  async assertBufferHealthAbove(minSeconds: number): Promise<void> {
    const metrics = await this.getQoEMetrics()
    expect(metrics.buffered).toBeGreaterThanOrEqual(minSeconds)
  }

  // ── Utilidades ────────────────────────────────────────────────────────────

  /** Espera a que el video esté en un readyState ≥ HAVE_ENOUGH_DATA (4) */
  async waitForCanPlay(timeout = 20_000): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const v = document.querySelector('video') ?? document.querySelector('audio')
        return v ? v.readyState >= 3 : false
      },
      { timeout }
    )
  }

  async destroy(): Promise<void> {
    await this.page.evaluate(() => window.__lightningPlayer?.destroy?.())
  }
}

// Extensión del tipo Window para TypeScript
declare global {
  interface Window {
    __lightningPlayer: {
      ready: boolean
      currentTime: number
      duration: number
      volume: number
      play(): void
      pause(): void
      destroy(): void
      isPlayingAd(): boolean
      getStatus(): PlayerStatus
      [key: string]: unknown
    }
    __lightningPlayerEvents: string[]
  }
}

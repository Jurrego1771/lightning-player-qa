/**
 * LightningPlayerPage — Page Object Model para el Lightning Player
 *
 * Toda interacción con el player pasa por aquí. Los tests nunca acceden
 * al DOM interno del player ni importan código del repo del player.
 *
 * API de referencia: docs/lightning_player.md en el repo del player.
 *
 * Método de inicialización principal: loadMSPlayer(containerId, config) → Promise
 * Método de carga dinámica: player.load({ type, id }) — prioridad en tests
 */
import * as fs from 'fs'
import * as path from 'path'
import { Page, expect } from '@playwright/test'
import { getEnvironmentConfig } from '../config/environments'

// ── Tipos de la API pública ───────────────────────────────────────────────

export type PlayerStatus = 'playing' | 'pause' | 'buffering' | 'idle'
export type ContentType = 'media' | 'live' | 'dvr' | 'episode'
export type PlayerView = 'video' | 'audio' | 'radio' | 'podcast' | 'reels' | 'compact' | 'none'

/**
 * Config de inicialización para loadMSPlayer().
 *
 * IMPORTANTE: El player usa `id` (ID de contenido en la plataforma Mediastream)
 * como campo obligatorio para cargar contenido de la plataforma.
 *
 * Para tests con src directo (stream externo), usar `src` como fallback — no
 * está documentado como init option oficial pero es un HTML5 attribute que
 * puede funcionar dependiendo del tipo de contenido.
 *
 * En la mayoría de tests usar `id` con contenido real de DEV.
 */
export interface InitConfig {
  type: ContentType
  id?: string        // ID de contenido en la plataforma Mediastream (preferido)
  src?: string       // URL directa del stream (fallback para tests con streams externos)
  autoplay?: boolean
  volume?: number
  view?: PlayerView
  player?: string
  appName?: string
  dnt?: boolean
  startPos?: number
  adsMap?: string    // VAST tag URL (camelCase de data-ads-map)
  accessToken?: string
  customer?: string
  [key: string]: unknown
}

/**
 * Opciones para player.load() — carga dinámica de contenido.
 * Referencia: sección "load options" en lightning_player.md
 */
export interface LoadOptions {
  type: ContentType
  id: string
}

export interface QoEMetrics {
  currentTime: number
  duration: number
  bufferedAhead: number   // segundos de buffer hacia adelante
  droppedFrames: number   // player.droppedFrames (Custom Attribute)
  readyState: number
  isLive: boolean
  isDVR: boolean
  status: PlayerStatus
}

export interface AdInfo {
  clickThroughUrl: string
  contentType: string
  currentTime: number
  duration: number
  podIndex: number
  remainingTime: number
  skippable: boolean
  isLinear: boolean
}

// ── Page Object ───────────────────────────────────────────────────────────

export class LightningPlayerPage {
  constructor(readonly page: Page) {}

  // ── Inicialización ────────────────────────────────────────────────────────

  /**
   * Carga el harness + script del player y lo inicializa con loadMSPlayer().
   *
   * El script se inyecta desde la CDN del ambiente activo (PLAYER_ENV).
   *   dev:     .../develop/api.js  (default)
   *   staging: .../staging/api.js
   *   prod:    .../api.js
   */
  async goto(config: InitConfig): Promise<void> {
    const envConfig = getEnvironmentConfig()
    const harnessPath = path.join(__dirname, '..', 'harness', 'index.html')
    const harnessHtml = fs.readFileSync(harnessPath, 'utf-8')

    await this.page.setContent(harnessHtml, { waitUntil: 'domcontentloaded' })

    // Inyectar el script del player desde CDN según el ambiente
    await this.page.addScriptTag({ url: envConfig.playerScriptUrl })

    // Dar tiempo al script para registrar loadMSPlayer en window
    await this.page.waitForFunction(() => typeof (window as any).loadMSPlayer === 'function', { timeout: 15_000 })

    // Inicializar con loadMSPlayer() via el harness
    await this.page.evaluate((cfg) => {
      (window as any).__initPlayer(cfg)
    }, config as Record<string, unknown>)
  }

  /**
   * Carga nuevo contenido en un player ya inicializado via player.load().
   * Este es el método principal para cambiar contenido dinámicamente.
   * Referencia: sección "load options" en lightning_player.md
   */
  async load(options: LoadOptions): Promise<void> {
    await this.page.evaluate((opts) => {
      return (window as any).__player?.load(opts)
    }, options as unknown as Record<string, unknown>)
    // Resetear eventos para el nuevo contenido
    await this.page.evaluate(() => {
      (window as any).__qa.events = []
      ;(window as any).__qa.ready = false
    })
  }

  // ── Estado del Player ─────────────────────────────────────────────────────

  async waitForReady(timeout = 30_000): Promise<void> {
    await this.page.waitForFunction(
      () => (window as any).__qa?.ready === true,
      { timeout }
    )
  }

  async waitForCanPlay(timeout = 15_000): Promise<void> {
    await this.waitForEvent('canplay', timeout)
  }

  /**
   * Espera a que un evento específico sea disparado por el player.
   * Los eventos se rastrean en window.__qa.events por el harness.
   */
  async waitForEvent(eventName: string, timeout = 15_000): Promise<void> {
    await this.page.waitForFunction(
      (name) => (window as any).__qa?.events?.includes(name),
      eventName,
      { timeout }
    )
  }

  async getStatus(): Promise<PlayerStatus> {
    return this.page.evaluate(() => (window as any).__player?.status ?? 'idle')
  }

  async isLive(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.isLive ?? false)
  }

  async isDVR(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.isDVR ?? false)
  }

  async getMetadata(): Promise<Record<string, unknown>> {
    return this.page.evaluate(() => (window as any).__player?.metadata ?? {})
  }

  // ── Controles de Playback ─────────────────────────────────────────────────

  async play(): Promise<void> {
    await this.page.evaluate(() => (window as any).__player?.play())
  }

  async pause(): Promise<void> {
    await this.page.evaluate(() => (window as any).__player?.pause())
  }

  async getCurrentTime(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.currentTime ?? 0)
  }

  async getDuration(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.duration ?? 0)
  }

  async seek(seconds: number): Promise<void> {
    await this.page.evaluate((t) => { (window as any).__player.currentTime = t }, seconds)
  }

  async setVolume(value: number): Promise<void> {
    await this.page.evaluate((v) => { (window as any).__player.volume = v }, value)
  }

  async getVolume(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.volume ?? 1)
  }

  async isPaused(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.paused ?? true)
  }

  async hasEnded(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.ended ?? false)
  }

  // ── Calidad / ABR ─────────────────────────────────────────────────────────

  /** Nivel de calidad actual (HLS.js only) */
  async getLevel(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.level ?? -1)
  }

  /** Lista de niveles disponibles (HLS.js only) */
  async getLevels(): Promise<unknown[]> {
    return this.page.evaluate(() => (window as any).__player?.levels ?? [])
  }

  /** Bitrate detectado (HLS.js only) */
  async getBitrate(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.bitrate ?? 0)
  }

  /** Bandwidth detectado (HLS.js only) */
  async getBandwidth(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.bandwidth ?? 0)
  }

  async setLevel(level: number): Promise<void> {
    await this.page.evaluate((l) => { (window as any).__player.level = l }, level)
  }

  // ── Controles UI ──────────────────────────────────────────────────────────

  async showControls(): Promise<void> {
    await this.page.evaluate(() => (window as any).__player?.showControls())
  }

  async hideControls(): Promise<void> {
    await this.page.evaluate(() => (window as any).__player?.hideControls())
  }

  async setFullscreen(value: boolean): Promise<void> {
    await this.page.evaluate((v) => { (window as any).__player.fullscreen = v }, value)
  }

  // ── Text Tracks (Subtítulos) ──────────────────────────────────────────────

  async getTextTracks(): Promise<Array<{ id: string; kind: string; label: string; language: string; mode: string }>> {
    return this.page.evaluate(() => {
      const tracks = (window as any).__player?.textTracks
      if (!tracks) return []
      return Array.from({ length: tracks.length }, (_, i) => ({
        id: tracks[i].id,
        kind: tracks[i].kind,
        label: tracks[i].label,
        language: tracks[i].language,
        mode: tracks[i].mode,
      }))
    })
  }

  async setTextTrackMode(trackId: string, mode: 'showing' | 'disabled'): Promise<void> {
    await this.page.evaluate(
      ({ id, m }) => {
        const tracks = (window as any).__player?.textTracks
        const track = tracks?.getTrackById(id)
        if (track) track.mode = m
      },
      { id: trackId, m: mode }
    )
  }

  // ── Audio Tracks ──────────────────────────────────────────────────────────

  async getAudioTracks(): Promise<Array<{ id: string; kind: string; label: string; language: string; enabled: boolean }>> {
    return this.page.evaluate(() => {
      const tracks = (window as any).__player?.audioTracks
      if (!tracks) return []
      return Array.from({ length: tracks.length }, (_, i) => ({
        id: tracks[i].id,
        kind: tracks[i].kind,
        label: tracks[i].label,
        language: tracks[i].language,
        enabled: tracks[i].enabled,
      }))
    })
  }

  async setAudioTrack(trackId: string): Promise<void> {
    await this.page.evaluate((id) => {
      const tracks = (window as any).__player?.audioTracks
      const track = tracks?.getTrackById(id)
      if (track) track.enabled = true
    }, trackId)
  }

  // ── Ads ───────────────────────────────────────────────────────────────────

  async getAdInfo(): Promise<AdInfo | null> {
    return this.page.evaluate(() => (window as any).__player?.ad?.info ?? null)
  }

  async getAdCuePoints(): Promise<number[]> {
    return this.page.evaluate(() => (window as any).__player?.ad?.cuePoints ?? [])
  }

  async skipAd(): Promise<void> {
    await this.page.evaluate(() => (window as any).__player?.ad?.skip())
  }

  async isAdSkippable(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.ad?.info?.skippable ?? false)
  }

  async waitForAdStart(timeout = 20_000): Promise<void> {
    await this.waitForEvent('adsStarted', timeout)
  }

  async waitForAdComplete(timeout = 60_000): Promise<void> {
    await this.waitForEvent('adsComplete', timeout)
  }

  async waitForAllAdsComplete(timeout = 120_000): Promise<void> {
    await this.waitForEvent('adsAllAdsCompleted', timeout)
  }

  // ── Métricas QoE ──────────────────────────────────────────────────────────

  async getQoEMetrics(): Promise<QoEMetrics> {
    return this.page.evaluate(() => {
      const p = (window as any).__player
      const video = document.querySelector('video') ?? document.querySelector('audio')
      return {
        currentTime: p?.currentTime ?? 0,
        duration: p?.duration ?? 0,
        bufferedAhead: video?.buffered.length
          ? video.buffered.end(video.buffered.length - 1) - (p?.currentTime ?? 0)
          : 0,
        droppedFrames: p?.droppedFrames ?? 0,  // Custom Attribute del player
        readyState: p?.readyState ?? 0,
        isLive: p?.isLive ?? false,
        isDVR: p?.isDVR ?? false,
        status: p?.status ?? 'idle',
      }
    })
  }

  async measureStartupTime(): Promise<number> {
    const start = Date.now()
    await this.waitForEvent('playing')
    return Date.now() - start
  }

  // ── Errores ───────────────────────────────────────────────────────────────

  async getErrors(): Promise<unknown[]> {
    return this.page.evaluate(() => (window as any).__qa?.errors ?? [])
  }

  async hasInitError(): Promise<string | null> {
    return this.page.evaluate(() => (window as any).__qa?.initError ?? null)
  }

  // ── Destroy ───────────────────────────────────────────────────────────────

  async destroy(): Promise<void> {
    await this.page.evaluate(() => (window as any).__player?.destroy?.())
  }

  // ── Aserciones ────────────────────────────────────────────────────────────

  async assertIsPlaying(): Promise<void> {
    await expect.poll(() => this.getStatus(), { timeout: 10_000 }).toBe('playing')
  }

  async assertIsPaused(): Promise<void> {
    await expect.poll(() => this.getStatus(), { timeout: 10_000 }).toBe('pause')
  }

  async assertCurrentTimeNear(expected: number, toleranceSec = 2): Promise<void> {
    const actual = await this.getCurrentTime()
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(toleranceSec)
  }

  async assertBufferHealthAbove(minSeconds: number): Promise<void> {
    const metrics = await this.getQoEMetrics()
    expect(metrics.bufferedAhead).toBeGreaterThanOrEqual(minSeconds)
  }

  async assertNoInitError(): Promise<void> {
    const err = await this.hasInitError()
    expect(err, `Player init error: ${err}`).toBeNull()
  }
}

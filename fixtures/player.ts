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

// Glob matches both http:// and https:// — player may use protocol-relative URL
const IMA_SDK_URL    = '**/imasdk.googleapis.com/js/sdkloader/ima3.js'
const IMA_SDK_CACHED = path.resolve(process.cwd(), 'fixtures/ima-sdk/ima3.js')

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
 *
 * Para contenido restringido (live/dvr con accessToken), pasar los mismos
 * campos que en InitConfig: accessToken, customer, etc.
 */
export interface LoadOptions {
  type: ContentType
  id: string
  accessToken?: string
  [key: string]: unknown
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
   * Navega al harness local (localhost:3000) e inicializa el player con loadMSPlayer().
   *
   * El harness se sirve desde un servidor HTTP local para que el origin de la página
   * sea http://localhost:3000 (no null). Esto es necesario para que los requests del
   * player al dominio de la plataforma funcionen correctamente con page.route() interceptors.
   *
   * El script del player se inyecta desde la CDN del ambiente activo (PLAYER_ENV).
   *   dev:     .../develop/api.js  (default)
   *   staging: .../staging/api.js
   *   prod:    .../api.js
   */
  async goto(config: InitConfig): Promise<void> {
    const envConfig = getEnvironmentConfig()

    // Registrar IMA SDK local ANTES de cualquier navegación.
    // Garantiza que la ruta esté activa desde el primer request, sin importar
    // cuándo el player decide cargar el SDK (puede ser inmediatamente al init).
    // adBeaconInterceptor ya no usa page.route('**/*'), así que no hay conflicto LIFO.
    if (config.adsMap && fs.existsSync(IMA_SDK_CACHED)) {
      const imaBody = fs.readFileSync(IMA_SDK_CACHED)
      await this.page.route(IMA_SDK_URL, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/javascript; charset=utf-8',
          body: imaBody,
        })
      })
    }

    // Navegar al harness (servido desde localhost:3000 por el webServer de Playwright)
    await this.page.goto('http://localhost:3000/index.html', { waitUntil: 'domcontentloaded' })

    // Inyectar el script del player desde CDN según el ambiente
    await this.page.addScriptTag({ url: envConfig.playerScriptUrl })

    // Esperar a que el script registre loadMSPlayer en window
    await this.page.waitForFunction(() => typeof (window as any).loadMSPlayer === 'function', { timeout: 15_000 })

    // Disparar init (fire-and-forget para no bloquear si la plataforma tarda)
    await this.page.evaluate((cfg) => {
      (window as any).__initPlayer(cfg)
    }, config as Record<string, unknown>)

    // Esperar a que el .then() del harness haya completado:
    // listeners registrados, backfill de eventos hecho, ready=true.
    // __qa.initialized se setea como ÚLTIMA línea del .then() en harness/index.html.
    await this.page.waitForFunction(
      () => (window as any).__qa?.initialized === true || (window as any).__qa?.initError != null,
      { timeout: 30_000 }
    )
  }

  /**
   * Navega al harness multi-init y carga el player via método alternativo:
   *   'callback' → data-loaded attribute (player llama window.__playerLoadedCallback)
   *   'event'    → playerloaded CustomEvent en el script element (event.detail = player)
   *
   * La plataforma está mockeada si el test usa isolatedPlayer (page.route interceptors
   * se mantienen activos entre navegaciones). El script del player se inyecta desde CDN
   * exactamente igual que en goto() — solo cambia el mecanismo de entrega de la instancia.
   */
  async gotoMultiInit(config: InitConfig, method: 'callback' | 'event'): Promise<void> {
    const envConfig = getEnvironmentConfig()
    const scriptUrl = envConfig.playerScriptUrl

    await this.page.goto('http://localhost:3000/multi-init.html', { waitUntil: 'domcontentloaded' })

    if (method === 'callback') {
      await this.page.evaluate(
        ({ url, cfg }) => (window as any).__initViaCallback(url, cfg),
        { url: scriptUrl, cfg: config as Record<string, unknown> }
      )
    } else {
      await this.page.evaluate(
        ({ url, cfg }) => (window as any).__initViaEvent(url, cfg),
        { url: scriptUrl, cfg: config as Record<string, unknown> }
      )
    }

    await this.page.waitForFunction(
      () => (window as any).__qa?.initialized === true || (window as any).__qa?.initError != null,
      { timeout: 30_000 }
    )
  }

  /**
   * Navega al harness multi-instancia e inicializa dos players simultáneamente.
   * Cada player tiene su propio event tracking en window.__qaMulti.players[0|1].
   * Compatible con isolatedPlayer: los page.route() interceptors cubren ambas instancias.
   *
   * Acceso a instancias desde tests:
   *   page.evaluate(() => window.player1)  — via métodos helper abajo
   *   page.evaluate(() => window.player2)
   *   page.evaluate(() => window.players[n])
   */
  async gotoMultiInstance(config1: InitConfig, config2: InitConfig): Promise<void> {
    const envConfig = getEnvironmentConfig()

    await this.page.goto('http://localhost:3000/multi-instance.html', { waitUntil: 'domcontentloaded' })

    await this.page.addScriptTag({ url: envConfig.playerScriptUrl })

    await this.page.waitForFunction(() => typeof (window as any).loadMSPlayer === 'function', { timeout: 15_000 })

    await this.page.evaluate(
      ([cfg1, cfg2]) => (window as any).__initMultiInstance(cfg1, cfg2),
      [config1 as Record<string, unknown>, config2 as Record<string, unknown>]
    )

    await this.page.waitForFunction(
      () => (window as any).__qaMulti?.allInitialized === true,
      { timeout: 30_000 }
    )
  }

  // ── Helpers multi-instancia ────────────────────────────────────────────────
  // Operan sobre window.players[n] — n es 0 (player1) o 1 (player2).

  async getEventsForPlayer(n: 0 | 1): Promise<string[]> {
    return this.page.evaluate((idx) => (window as any).__qaMulti?.players[idx]?.events ?? [], n)
  }

  async waitForEventOnPlayer(n: 0 | 1, eventName: string, timeout = 15_000): Promise<void> {
    await this.page.waitForFunction(
      ([idx, name]) => (window as any).__qaMulti?.players[idx]?.events?.includes(name),
      [n, eventName] as [number, string],
      { timeout }
    )
  }

  async getStatusOfPlayer(n: 0 | 1): Promise<PlayerStatus> {
    return this.page.evaluate((idx) => (window as any).players[idx]?.status ?? 'idle', n)
  }

  async getVolumeOfPlayer(n: 0 | 1): Promise<number> {
    return this.page.evaluate((idx) => Number((window as any).players[idx]?.volume ?? -1), n)
  }

  async setVolumeOnPlayer(n: 0 | 1, volume: number): Promise<void> {
    await this.page.evaluate(([idx, v]) => { (window as any).players[idx].volume = v }, [n, volume] as [number, number])
  }

  async playPlayer(n: 0 | 1): Promise<void> {
    await this.page.evaluate((idx) => (window as any).players[idx]?.play(), n)
  }

  async pausePlayer(n: 0 | 1): Promise<void> {
    await this.page.evaluate((idx) => (window as any).players[idx]?.pause(), n)
  }

  async destroyPlayer(n: 0 | 1): Promise<void> {
    await this.page.evaluate((idx) => (window as any).players[idx]?.destroy?.(), n)
  }

  async hasInitErrorForPlayer(n: 0 | 1): Promise<string | null> {
    return this.page.evaluate((idx) => (window as any).__qaMulti?.players[idx]?.initError ?? null, n)
  }

  /**
   * Carga nuevo contenido en un player ya inicializado via player.load().
   * Este es el método principal para cambiar contenido dinámicamente.
   * Referencia: sección "load options" en lightning_player.md
   */
  async load(options: LoadOptions): Promise<void> {
    // Resetear eventos ANTES de llamar a load() para no perder eventos del nuevo contenido
    // (sourcechange, metadataloaded, etc. pueden dispararse durante la llamada)
    await this.page.evaluate(() => {
      ;(window as any).__qa.events = []
      ;(window as any).__qa.ready = false
    })
    await this.page.evaluate((opts) => {
      return (window as any).__player?.load(opts)
    }, options as unknown as Record<string, unknown>)
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

  async clearTrackedEvents(): Promise<void> {
    await this.page.evaluate(() => {
      ;(window as any).__qa.events = []
      ;(window as any).__qa.eventData = {}
      ;(window as any).__qa.ready = false
    })
  }

  async getEventData<T = unknown>(eventName: string): Promise<T | undefined> {
    return this.page.evaluate((name) => (window as any).__qa?.eventData?.[name], eventName)
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
    // Retry hasta que el player esté listo internamente.
    // En v1.0.57+ el player puede lanzar "Player is not ready" si pause() se llama
    // antes de que su evento 'ready' interno se dispare (puede ser async post-Promise).
    await expect(async () => {
      await this.page.evaluate(() => (window as any).__player?.pause())
    }).toPass({ timeout: 5_000 })
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

  async isMuted(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.muted ?? false)
  }

  async setMuted(muted: boolean): Promise<void> {
    await this.page.evaluate((m) => { (window as any).__player.muted = m }, muted)
  }

  async getPlaybackRate(): Promise<number> {
    return this.page.evaluate(() => (window as any).__player?.playbackRate ?? 1)
  }

  async setPlaybackRate(rate: number): Promise<void> {
    await this.page.evaluate((r) => { (window as any).__player.playbackRate = r }, rate)
  }

  async updateNextEpisode(data: Record<string, unknown>): Promise<void> {
    await this.page.evaluate((payload) => {
      ;(window as any).__player?.updateNextEpisode?.(payload)
    }, data)
  }

  async playNext(): Promise<unknown> {
    return this.page.evaluate(() => (window as any).__player?.playNext?.())
  }

  async keepWatching(): Promise<unknown> {
    return this.page.evaluate(() => (window as any).__player?.keepWatching?.())
  }

  async getReadyState(): Promise<number> {
    // player.readyState no está expuesto — leer del elemento HTML5 directamente
    return this.page.evaluate(() => {
      const v = document.querySelector('video') ?? document.querySelector('audio')
      return v?.readyState ?? 0
    })
  }

  async getHandler(): Promise<string> {
    return this.page.evaluate(() => (window as any).__player?.handler ?? '')
  }

  async getVersion(): Promise<string> {
    return this.page.evaluate(() => (window as any).__player?.version ?? '')
  }

  async getType(): Promise<string> {
    return this.page.evaluate(() => (window as any).__player?.type ?? '')
  }

  async getLoop(): Promise<boolean> {
    return this.page.evaluate(() => (window as any).__player?.loop ?? false)
  }

  async setLoop(value: boolean): Promise<void> {
    await this.page.evaluate((v) => { (window as any).__player.loop = v }, value)
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

  /**
   * Espera a que el player tenga exactamente `count` text tracks con sus metadatos
   * completos (language no vacío en todos). Necesario porque los tracks pueden
   * aparecer en la lista antes de que el parser popule sus propiedades.
   */
  async waitForTextTracks(count: number, timeout = 10_000): Promise<void> {
    await this.page.waitForFunction(
      (expectedCount) => {
        const tracks = (window as any).__player?.textTracks
        if (!tracks || tracks.length < expectedCount) return false
        // Todos los tracks deben tener language populado
        for (let i = 0; i < tracks.length; i++) {
          if (!tracks[i].language) return false
        }
        return true
      },
      count,
      { timeout }
    )
  }

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

import * as fs from 'fs'
import * as path from 'path'
import { PlayerBase } from './PlayerBase'
import { getEnvironmentConfig } from '../../config/environments'
import type { InitConfig, LoadOptions, PlayerStatus } from '../player-types'

const IMA_SDK_URL    = '**/imasdk.googleapis.com/js/sdkloader/ima3.js'
const IMA_SDK_CACHED = path.resolve(process.cwd(), 'fixtures/ima-sdk/ima3.js')

export class PlayerWithInit extends PlayerBase {

  // ── Inicialización ────────────────────────────────────────────────────────

  /**
   * Navega al harness local e inicializa el player con loadMSPlayer().
   * Harness en localhost:3000 para que page.route() interceptors funcionen correctamente.
   *
   * Acepta un hook opcional `beforeInit` que se llama después de que el script del player
   * carga pero ANTES de que se llame a loadMSPlayer() — útil para medir startup time
   * real (excluye descarga del script) o para aplicar CDP throttling solo al media.
   */
  async goto(
    config: InitConfig,
    options?: { beforeInit?: () => Promise<void> }
  ): Promise<void> {
    const envConfig = getEnvironmentConfig()

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

    await this.page.goto('http://localhost:3000/index.html', { waitUntil: 'domcontentloaded' })
    await this.page.addScriptTag({ url: envConfig.playerScriptUrl })
    await this.page.waitForFunction(() => typeof (window as any).loadMSPlayer === 'function', { timeout: 15_000 })

    if (options?.beforeInit) {
      await options.beforeInit()
    }

    await this.page.evaluate((cfg) => {
      ;(window as any).__initPlayer(cfg)
    }, config as Record<string, unknown>)

    await this.page.waitForFunction(
      () => (window as any).__qa?.initialized === true || (window as any).__qa?.initError != null,
      { timeout: 30_000 }
    )
  }

  /**
   * Inicializa el player via método alternativo:
   *   'callback' → data-loaded attribute
   *   'event'    → playerloaded CustomEvent
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
   * Inicializa dos players simultáneamente en el harness multi-instancia.
   * Cada player trackea eventos en window.__qaMulti.players[0|1].
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

  /**
   * Carga nuevo contenido en un player ya inicializado via player.load().
   * Resetea eventos ANTES de llamar a load() para no perder eventos del nuevo contenido.
   */
  async load(options: LoadOptions): Promise<void> {
    await this.page.evaluate(() => {
      ;(window as any).__qa.events = []
      ;(window as any).__qa.ready = false
    })
    await this.page.evaluate((opts) => {
      return (window as any).__player?.load(opts)
    }, options as unknown as Record<string, unknown>)
  }

  // ── Helpers multi-instancia ────────────────────────────────────────────────

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
}

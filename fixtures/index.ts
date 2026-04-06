/**
 * fixtures/index.ts — Punto de entrada para fixtures de Playwright
 *
 * Los tests siempre importan desde aquí, nunca de @playwright/test directamente.
 * Permite inyectar fixtures customizados y mantener un contrato estable.
 */
import { test as base, expect } from '@playwright/test'
import { LightningPlayerPage } from './player'
import { setupPlatformMocks } from './platform-mock'

export { expect } from '@playwright/test'
export { ContentIds, ContentAccess, ExternalStreams, Streams, NetworkProfiles, MockContentIds, LocalStreams } from './streams'
export type { InitConfig, LoadOptions, PlayerStatus, QoEMetrics, AdInfo } from './player'
export { setupPlatformMocks, mockContentConfig, mockPlayerConfig, mockContentError } from './platform-mock'

// ── Custom Fixtures ───────────────────────────────────────────────────────

type LightningFixtures = {
  /** Player contra plataforma real (E2E, smoke, performance) */
  player: LightningPlayerPage

  /**
   * Player con plataforma mockeada + streams HLS locales (integración, visual, a11y).
   * La plataforma Mediastream está interceptada: no se hacen requests a develop.mdstrm.com.
   * Los streams apuntan a localhost:9001 (servido por webServer en playwright.config.ts).
   * Usar con MockContentIds: isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod })
   */
  isolatedPlayer: LightningPlayerPage

  /** Interceptor de red para verificar beacons de ads sin disparar URLs reales */
  adBeaconInterceptor: AdBeaconInterceptor
}

export const test = base.extend<LightningFixtures>({
  player: async ({ page }, use) => {
    const player = new LightningPlayerPage(page)
    await use(player)
  },

  isolatedPlayer: async ({ page }, use) => {
    await setupPlatformMocks(page)
    const isolated = new LightningPlayerPage(page)
    await use(isolated)
  },

  adBeaconInterceptor: async ({ page }, use) => {
    const interceptor = new AdBeaconInterceptor(page)
    await interceptor.start()
    await use(interceptor)
    interceptor.stop()
  },
})

// ── Ad Beacon Interceptor ─────────────────────────────────────────────────
//
// Para tests de beacons, interceptamos requests de red con Playwright
// y verificamos que se disparen las URLs correctas.
// El player emite sus propios eventos (adsFirstQuartile, etc.) via player.on()
// que se rastrean en window.__qa.events — preferir esos para tests unitarios.
// Este interceptor es para validar que los beacons HTTP realmente se envíen.

import { Page } from '@playwright/test'

export class AdBeaconInterceptor {
  private capturedBeacons: Array<{ url: string; timestamp: number }> = []

  constructor(private readonly page: Page) {}

  async start(): Promise<void> {
    await this.page.route('**/*', async (route) => {
      const url = route.request().url()
      if (this.isBeaconUrl(url)) {
        this.capturedBeacons.push({ url, timestamp: Date.now() })
      }
      await route.continue()
    })
  }

  stop(): void {
    this.capturedBeacons = []
  }

  getBeacons(pattern: string | RegExp): Array<{ url: string; timestamp: number }> {
    return this.capturedBeacons.filter(({ url }) =>
      typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)
    )
  }

  wasFired(pattern: string | RegExp): boolean {
    return this.getBeacons(pattern).length > 0
  }

  all(): Array<{ url: string; timestamp: number }> {
    return [...this.capturedBeacons]
  }

  private isBeaconUrl(url: string): boolean {
    return [
      '/impression', '/firstQuartile', '/midpoint', '/thirdQuartile', '/complete',
      '/click', '/skip', '/error', '/track/',
      'doubleclick.net', 'googlesyndication', 'adsystem', 'adserver',
      'localhost:9999/track',
    ].some((p) => url.includes(p))
  }
}

/**
 * fixtures/index.ts — Punto de entrada para fixtures de Playwright
 *
 * Los tests importan desde aquí en lugar de desde @playwright/test directamente,
 * lo que nos permite inyectar el Page Object y fixtures customizados.
 */
import { test as base, expect } from '@playwright/test'
import { LightningPlayerPage } from './player'

export { expect } from '@playwright/test'
export { Streams, NetworkProfiles } from './streams'
export type { PlayerConfig, PlayerStatus, QoEMetrics } from './player'

// ── Custom Fixtures ───────────────────────────────────────────────────────

type LightningFixtures = {
  /** Instancia del Page Object del player, lista para usar */
  player: LightningPlayerPage

  /** Interceptor de red para capturar beacons de ads */
  adBeaconInterceptor: AdBeaconInterceptor
}

export const test = base.extend<LightningFixtures>({
  player: async ({ page }, use) => {
    const player = new LightningPlayerPage(page)
    await use(player)
  },

  adBeaconInterceptor: async ({ page }, use) => {
    const interceptor = new AdBeaconInterceptor(page)
    await interceptor.start()
    await use(interceptor)
    interceptor.stop()
  },
})

// ── Ad Beacon Interceptor ─────────────────────────────────────────────────

import { Page, Route, Request } from '@playwright/test'

export class AdBeaconInterceptor {
  private capturedBeacons: Array<{ url: string; timestamp: number }> = []
  private routes: Route[] = []

  constructor(private readonly page: Page) {}

  async start(): Promise<void> {
    // Captura todas las requests que parezcan beacons de tracking de ads
    await this.page.route('**/*', (route) => {
      const url = route.request().url()
      if (this.isBeaconUrl(url)) {
        this.capturedBeacons.push({ url, timestamp: Date.now() })
      }
      route.continue()
    })
  }

  stop(): void {
    this.capturedBeacons = []
  }

  getBeaconsMatching(pattern: string | RegExp): Array<{ url: string; timestamp: number }> {
    return this.capturedBeacons.filter(({ url }) =>
      typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)
    )
  }

  wasBeaconFired(pattern: string | RegExp): boolean {
    return this.getBeaconsMatching(pattern).length > 0
  }

  private isBeaconUrl(url: string): boolean {
    const beaconPatterns = [
      '/impression',
      '/firstQuartile',
      '/midpoint',
      '/thirdQuartile',
      '/complete',
      '/click',
      'doubleclick.net',
      'googlesyndication',
      'adsystem',
      'adserver',
    ]
    return beaconPatterns.some((p) => url.includes(p))
  }
}

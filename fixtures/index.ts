/**
 * fixtures/index.ts — Punto de entrada para fixtures de Playwright
 *
 * Los tests siempre importan desde aquí, nunca de @playwright/test directamente.
 * Permite inyectar fixtures customizados y mantener un contrato estable.
 */
import { test as base, expect } from '@playwright/test'
import { LightningPlayerPage } from './player'
import { setupPlatformMocks } from './platform-mock'
import { generateAccessToken, isAccessTokenAvailable } from '../helpers/access-token'
import { ContentIds } from './streams'
import * as fs   from 'fs'
import * as path from 'path'

// ── Quarantine auto-fixture ───────────────────────────────────────────────────
// Lee quarantine.json una sola vez al arrancar (module-level cache).
// Si un test está cuarentenado, se marca fixme() — no bloquea CI pero aparece
// en el reporte como "expected to fail", haciendo el problema visible.

const QUARANTINE_FILE = path.join(process.cwd(), 'flaky-results', 'quarantine.json')

const _quarantinedIds: Set<string> = new Set()

try {
  if (fs.existsSync(QUARANTINE_FILE)) {
    const data = JSON.parse(fs.readFileSync(QUARANTINE_FILE, 'utf-8'))
    for (const entry of data.quarantined ?? []) {
      _quarantinedIds.add(entry.id)
    }
  }
} catch {
  // Si falla la lectura, continuar sin cuarentena (no bloquear tests)
}

export { expect } from '@playwright/test'
export { ContentIds, ContentAccess, ExternalStreams, Streams, NetworkProfiles, MockContentIds, LocalStreams } from './streams'
export type { InitConfig, LoadOptions, PlayerStatus, QoEMetrics, AdInfo, LightningPlayerPage } from './player'
export { setupPlatformMocks, mockContentConfig, mockPlayerConfig, mockContentError, mockAudioPlayerConfig } from './platform-mock'
export { generateAccessToken, isAccessTokenAvailable } from '../helpers/access-token'

// ── Custom Fixtures ───────────────────────────────────────────────────────

type LightningFixtures = {
  /** Player contra plataforma real (E2E, smoke, performance) */
  player: LightningPlayerPage

  /**
   * Player con plataforma mockeada + streams HLS locales (integración, visual, a11y).
   * La plataforma Mediastream está interceptada: no se hacen requests al servidor de plataforma.
   * El dominio interceptado varía por ambiente (develop/staging/embed).mdstrm.com.
   * Los streams apuntan a localhost:9001 (servido por webServer en playwright.config.ts).
   * Usar con MockContentIds: isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod })
   */
  isolatedPlayer: LightningPlayerPage

  /** Interceptor de red para verificar beacons de ads sin disparar URLs reales */
  adBeaconInterceptor: AdBeaconInterceptor

  /**
   * Fixture de cuarentena — se auto-aplica en cada test.
   * Si el test aparece en flaky-results/quarantine.json, se marca como fixme()
   * para que no bloquee CI mientras se investiga.
   * No usar directamente: es una fixture "automatic" que corre siempre.
   */
  _quarantine: void

  /**
   * Access tokens frescos para contenido con restricción de acceso.
   *
   * Genera un token por test llamando a POST /api/access/issue en la
   * plataforma Mediastream. Los tokens son de un solo uso — si dos tests
   * comparten el mismo token en paralelo, el segundo falla con 403.
   *
   * Requiere PLATFORM_API_TOKEN en .env. Si no está, el test se salta
   * con un mensaje claro en lugar de fallar con un error críptico.
   *
   * Uso:
   *   test('live test', async ({ player, contentAccess }) => {
   *     await player.goto({ type: 'live', id: ContentIds.live, ...contentAccess.live })
   *   })
   */
  contentAccess: {
    live: { accessToken: string }
    dvr:  { accessToken: string }
  }
}

export const test = base.extend<LightningFixtures>({
  // Quarantine fixture — corre automáticamente antes de cada test.
  // Construye el ID del test igual que FlakinessReporter para que coincidan.
  _quarantine: [async ({}, use, testInfo) => {
    if (_quarantinedIds.size > 0) {
      const id = testInfo.titlePath.join(' > ')
      if (_quarantinedIds.has(id)) {
        testInfo.fixme(true, `[Quarantine] Test con flakiness score alto — ver flaky-results/quarantine.json`)
      }
    }
    await use()
  }, { auto: true }],

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
    interceptor.start()
    await use(interceptor)
    interceptor.stop()
  },

  contentAccess: async ({}, use, testInfo) => {
    // Sin API token configurado → skip con mensaje claro en lugar de fallar con 403
    if (!isAccessTokenAvailable()) {
      testInfo.skip(
        true,
        'PLATFORM_API_TOKEN no configurado — test requiere access token para contenido restringido. ' +
        'Agregar a .env: PLATFORM_API_TOKEN=<token-de-api-admin>'
      )
      // use() nunca se llama cuando skip=true, pero TypeScript lo requiere
      await use({ live: { accessToken: '' }, dvr: { accessToken: '' } })
      return
    }

    // Generar tokens frescos en paralelo.
    // Cada test obtiene su propio token — son single-use y no se pueden compartir
    // entre tests que corran en paralelo (dos workers usarían el mismo token y el
    // segundo recibiría 403 del servidor de streaming).
    // ContentIds.live === ContentIds.dvr (mismo stream, diferente mode),
    // pero igual se generan dos tokens separados por seguridad.
    let liveToken: string
    let dvrToken:  string

    try {
      ;[liveToken, dvrToken] = await Promise.all([
        generateAccessToken(ContentIds.live, 'live'),
        generateAccessToken(ContentIds.dvr,  'live'),
      ])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`[contentAccess fixture] Falló la generación del token:\n${msg}`)
    }

    await use({
      live: { accessToken: liveToken },
      dvr:  { accessToken: dvrToken },
    })
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

  start(): void {
    this._handler = (request: import('@playwright/test').Request) => {
      const url = request.url()
      if (this.isBeaconUrl(url)) {
        this.capturedBeacons.push({ url, timestamp: Date.now() })
      }
    }
    this.page.on('request', this._handler)
  }

  stop(): void {
    if (this._handler) {
      this.page.off('request', this._handler)
      this._handler = undefined
    }
    this.capturedBeacons = []
  }

  private _handler?: (request: import('@playwright/test').Request) => void

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

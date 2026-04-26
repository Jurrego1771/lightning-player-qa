/**
 * player-init-methods.spec.ts — Los 3 métodos de inicialización del Lightning Player
 *
 * Cubre los 3 métodos documentados en lightning_player.md § Usage:
 *   1. loadMSPlayer(containerId, config) → Promise<player>   harness/index.html
 *   2. Script tag con data-loaded callback                    harness/multi-init.html
 *   3. Script tag con playerloaded CustomEvent                harness/multi-init.html
 *
 * Criterios de aceptación (por método):
 *   DEBE: player inicializar sin error
 *   DEBE: window.__player expuesto con API completa
 *   DEBE: __qa.initialized = true (gate que usa el fixture)
 *   DEBE: eventos estándar (ready, loaded, metadataloaded) en __qa.events
 *   DEBE: __qa.initMethod = 'promise' | 'callback' | 'event'
 *   DEBE: config volume aplicado al inicializar
 *   DEBE: autoplay: false → player no inicia reproducción sola
 *
 * Fixture: isolatedPlayer (plataforma mockeada — misma infraestructura que todos los demás tests)
 * Tag: @integration
 *
 * Fuera de scope:
 *   - Comportamiento de playback post-init (cubierto por specs de feature)
 *   - Atributos data-* no soportados por el harness (custom-*, ref, listener-id, etc.)
 */
import { test, expect, MockContentIds } from '../../fixtures'
import type { LightningPlayerPage, InitConfig } from '../../fixtures'

// ── Métodos de init y cómo arrancarlos ────────────────────────────────────────

const INIT_METHODS = [
  { id: 'promise'  as const, label: 'loadMSPlayer() Promise'   },
  { id: 'callback' as const, label: 'data-loaded callback'     },
  { id: 'event'    as const, label: 'playerloaded CustomEvent' },
]

async function initPlayer(
  player: LightningPlayerPage,
  config: InitConfig,
  method: typeof INIT_METHODS[number]['id'],
): Promise<void> {
  return method === 'promise'
    ? player.goto(config)
    : player.gotoMultiInit(config, method)
}

// ── Suite parametrizada: 3 métodos × 6 tests = 18 tests ──────────────────────

for (const { id: method, label } of INIT_METHODS) {

  test.describe(`Init: ${label}`, { tag: ['@integration'] }, () => {

    test(`player inicializa sin error [${method}]`, async ({ isolatedPlayer: player }) => {
      await initPlayer(player, { type: 'media', id: MockContentIds.vod, autoplay: false }, method)
      await player.assertNoInitError()
    })

    test(`window.__player expuesto con API completa [${method}]`, async ({ isolatedPlayer: player, page }) => {
      await initPlayer(player, { type: 'media', id: MockContentIds.vod, autoplay: false }, method)

      const surface = await page.evaluate(() => {
        const p = (window as any).__player
        return {
          defined:    !!p,
          hasPlay:    typeof p?.play    === 'function',
          hasPause:   typeof p?.pause   === 'function',
          hasDestroy: typeof p?.destroy === 'function',
          hasOn:      typeof p?.on      === 'function',
        }
      })

      expect(surface.defined).toBe(true)
      expect(surface.hasPlay).toBe(true)
      expect(surface.hasPause).toBe(true)
      expect(surface.hasDestroy).toBe(true)
      expect(surface.hasOn).toBe(true)
    })

    test(`eventos estándar rastreados en __qa.events [${method}]`, async ({ isolatedPlayer: player, page }) => {
      await initPlayer(player, { type: 'media', id: MockContentIds.vod, autoplay: false }, method)
      await player.waitForEvent('ready', 20_000)

      const events: string[] = await page.evaluate(() => (window as any).__qa.events ?? [])
      expect(events, 'ready debe estar en __qa.events').toContain('ready')
      expect(events, 'loaded debe estar en __qa.events').toContain('loaded')
      expect(events, 'metadataloaded debe estar en __qa.events').toContain('metadataloaded')
    })

    test(`__qa.initMethod registra '${method}' [${method}]`, async ({ isolatedPlayer: player, page }) => {
      await initPlayer(player, { type: 'media', id: MockContentIds.vod, autoplay: false }, method)
      await player.waitForEvent('ready', 20_000)

      const recorded: string = await page.evaluate(() => (window as any).__qa.initMethod)
      expect(recorded, '__qa.initMethod debe reflejar el método usado').toBe(method)
    })

    test(`volume inicial aplicado [${method}]`, async ({ isolatedPlayer: player }) => {
      await initPlayer(player, { type: 'media', id: MockContentIds.vod, volume: 0.3, autoplay: false }, method)
      await player.waitForEvent('ready', 20_000)

      await expect.poll(
        () => player.getVolume(),
        { timeout: 5_000, message: 'player.volume debe reflejar el valor pasado en config' },
      ).toBeCloseTo(0.3, 1)
    })

    test(`autoplay: false → player no inicia reproducción [${method}]`, async ({ isolatedPlayer: player, page }) => {
      await initPlayer(player, { type: 'media', id: MockContentIds.vod, autoplay: false }, method)
      await player.waitForEvent('ready', 20_000)

      const paused: boolean = await page.evaluate(() => (window as any).__player?.paused ?? true)
      expect(paused, 'player debe estar pausado cuando autoplay=false').toBe(true)
    })

  })
}

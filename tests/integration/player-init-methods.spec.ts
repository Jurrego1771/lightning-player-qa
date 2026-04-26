/**
 * player-init-methods.spec.ts — Métodos de inicialización del Lightning Player
 *
 * Cubre los 3 métodos de init documentados en lightning_player.md:
 *   1. loadMSPlayer(containerId, config) → Promise  ← cubierto por TODOS los otros specs
 *   2. Script tag con data-loaded callback          ← cubierto aquí
 *   3. Script tag con playerloaded event            ← cubierto aquí
 *
 * Para métodos 2 y 3 se usa harness/multi-init.html, que expone
 * __initViaCallback() y __initViaEvent() en lugar de __initPlayer().
 *
 * Criterios de aceptación:
 *   DEBE: player inicializar correctamente con cada método
 *   DEBE: window.__player expuesto (Page Object puede interactuar)
 *   DEBE: window.__qa.initialized = true al terminar
 *   DEBE: eventos estándar (ready, loaded, metadataloaded) presentes en __qa.events
 *   DEBE: __qa.initMethod registrar el método usado
 *
 * Fixture: isolatedPlayer (plataforma mockeada — mismo contexto que otros integration tests)
 * Tag: @integration
 *
 * Fuera de scope:
 *   - loadMSPlayer Promise (cubierto implícitamente por todos los demás specs)
 *   - Comportamiento de playback post-init (eso es responsabilidad de los specs de feature)
 */
import { test, expect, MockContentIds } from '../../fixtures'

const INIT_METHODS = ['callback', 'event'] as const
type InitMethod = typeof INIT_METHODS[number]

for (const method of INIT_METHODS) {
  test.describe(`Init method: ${method}`, { tag: ['@integration'] }, () => {

    test(`player inicializa correctamente via ${method}`, async ({ isolatedPlayer: player }) => {
      await player.gotoMultiInit({ type: 'media', id: MockContentIds.vod, autoplay: true }, method)
      await player.waitForEvent('playing', 20_000)
      await player.assertNoInitError()
    })

    test(`window.__player queda expuesto via ${method}`, async ({ isolatedPlayer: player, page }) => {
      await player.gotoMultiInit({ type: 'media', id: MockContentIds.vod }, method)
      await player.waitForEvent('ready', 20_000)

      const hasPlayer = await page.evaluate(() => typeof (window as any).__player !== 'undefined')
      expect(hasPlayer, 'window.__player debe existir después de init').toBe(true)
    })

    test(`eventos estándar rastreados en __qa.events via ${method}`, async ({ isolatedPlayer: player, page }) => {
      await player.gotoMultiInit({ type: 'media', id: MockContentIds.vod, autoplay: true }, method)
      await player.waitForEvent('playing', 20_000)

      const events: string[] = await page.evaluate(() => (window as any).__qa.events ?? [])
      expect(events, 'ready debe estar en __qa.events').toContain('ready')
      expect(events, 'loaded debe estar en __qa.events').toContain('loaded')
      expect(events, 'metadataloaded debe estar en __qa.events').toContain('metadataloaded')
    })

    test(`__qa.initMethod registra '${method}'`, async ({ isolatedPlayer: player, page }) => {
      await player.gotoMultiInit({ type: 'media', id: MockContentIds.vod }, method)
      await player.waitForEvent('ready', 20_000)

      const initMethod: string = await page.evaluate(() => (window as any).__qa.initMethod)
      expect(initMethod).toBe(method)
    })

  })
}

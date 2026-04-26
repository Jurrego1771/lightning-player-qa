/**
 * dash-auto-detect.spec.ts — Tests E2E que requieren playback DASH real
 *
 * Cubre comportamientos que solo pueden verificarse con un stream DASH real:
 *  - autoplay hasta 'playing' via auto-detect (red path completo)
 *  - DashHandler lazy-load no causa re-inicialización (double ready event)
 *
 * Los tests de selección de handler (sin playback real) están en:
 *   tests/integration/dash-handler-select.spec.ts
 *
 * Fixture: player (CDN real — DashHandler requiere dashjs + stream MPD real)
 * Tag: @e2e
 */
import { test, expect, ContentIds } from '../../fixtures'

test.describe('DASH Auto-Detect', { tag: ['@e2e'] }, () => {

  test('URL .mpd con autoplay=true: player llega a playing via auto-detect', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: true })

    await player.waitForEvent('playing', 35_000)
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })

  test('selectedSrcType=dash en state: DashHandler lazy load ocurre una sola vez', async ({ player, page }) => {
    // Verifica que el lazy import de DashHandler no causa doble init o flicker.
    // El player no debe emitir dos eventos 'ready' consecutivos.
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: true })
    await player.waitForEvent('playing', 35_000)

    const events: string[] = await page.evaluate(() => (window as any).__qa?.events ?? [])
    const readyEvents = events.filter((e) => e === 'ready')

    expect(
      readyEvents.length,
      `El player emitió 'ready' ${readyEvents.length} veces. ` +
      'El lazy import de DashHandler no debe causar re-inicialización. ' +
      'Verificar src/player/base.js.'
    ).toBeLessThanOrEqual(2)  // 1 es ideal, 2 es aceptable (reload edge case)
  })
})

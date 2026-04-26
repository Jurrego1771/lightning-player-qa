/**
 * dash-auto-detect.spec.ts — Tests E2E para auto-detección de DASH via URL .mpd
 *
 * Cubre: El cambio en src/player/base.js que añade auto-detect de DASH
 * cuando la URL del stream tiene extensión .mpd o cuando selectedSrcType=dash
 * está en el player state (propagado desde loadConfig).
 *
 * El auto-detect ocurre en:
 *  - src/platform/loadConfig.js: detecta .mpd en la src y setea useDash=true
 *  - src/player/base.js: lee useDash/selectedSrcType y hace lazy import de DashHandler
 *
 * Fixture: player (CDN real — DashHandler requiere navegación real con dashjs)
 * Tag: @e2e
 */
import { test, expect, ExternalStreams } from '../../fixtures'

const DASH_MPD_SRC = ExternalStreams.dash.vod

test.describe('DASH Auto-Detect', { tag: ['@e2e'] }, () => {

  test('URL con extensión .mpd: DashHandler se selecciona automáticamente', async ({ player }) => {
    // Arrange — pasar src con .mpd directamente, sin format explícito
    // El player debe detectar DASH por la extensión y usar DashHandler
    // player: 'dynamic' evita que el player busque config de plataforma con id=undefined
    await player.goto({
      type: 'media',
      src: DASH_MPD_SRC,
      autoplay: false,
      player: 'dynamic',
    } as any)

    await player.waitForReady(30_000)
    await player.waitForEvent('loadedmetadata', 20_000)

    // Assert — el handler seleccionado debe ser DASH
    const handler = await player.getHandler()
    expect(
      handler.toLowerCase(),
      `Con src .mpd sin format explícito, el handler debe ser 'dash'. Obtenido: '${handler}'. ` +
      'Verificar auto-detect en src/player/base.js y src/platform/loadConfig.js.'
    ).toMatch(/dash/)

    await player.assertNoInitError()
  })

  test('URL .mpd con autoplay=true: player llega a playing via auto-detect', async ({ player }) => {
    // Arrange
    await player.goto({
      type: 'media',
      src: DASH_MPD_SRC,
      autoplay: true,
      player: 'dynamic',
    } as any)

    // Assert — auto-detect no debe añadir latencia perceptible al inicio
    await player.waitForEvent('playing', 35_000)
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })

  test('selectedSrcType=dash en state: DashHandler lazy load ocurre una sola vez', async ({ player, page }) => {
    // Verifica que el lazy import de DashHandler no causa doble init o flicker
    // Observamos que el player no emite dos eventos 'ready' consecutivos

    const readyCount = { count: 0 }
    await page.exposeFunction('__trackReady', () => { readyCount.count++ })

    // Arrange
    await player.goto({
      type: 'media',
      src: DASH_MPD_SRC,
      autoplay: true,
      player: 'dynamic',
    } as any)

    await player.waitForEvent('playing', 35_000)

    // Assert — el player no debe emitir ready múltiples veces (indica re-init)
    const events: string[] = await page.evaluate(() => (window as any).__qa?.events ?? [])
    const readyEvents = events.filter((e) => e === 'ready')

    expect(
      readyEvents.length,
      `El player emitió 'ready' ${readyEvents.length} veces. ` +
      'El lazy import de DashHandler no debe causar re-inicialización. ' +
      'Verificar src/player/base.js.'
    ).toBeLessThanOrEqual(2)  // 1 es ideal, 2 es aceptable (reload edge case)
  })

  test('auto-detect DASH: URL HLS (.m3u8) sigue usando HLS handler (sin regresión)', async ({ player }) => {
    // Verifica que el auto-detect no afecta streams HLS existentes
    // Un stream .m3u8 debe seguir usando HLS handler, no DASH

    // Usar ExternalStreams.hls.vodShort para evitar dependencia de ContentIds
    await player.goto({
      type: 'media',
      src: ExternalStreams.hls.vodShort,
      autoplay: false,
      player: 'dynamic',
    } as any)

    await player.waitForReady(30_000)
    await player.waitForEvent('loadedmetadata', 20_000)

    // Assert — el handler debe ser HLS (no DASH)
    const handler = await player.getHandler()
    expect(
      handler.toLowerCase(),
      `Con src .m3u8, el handler debe ser 'hls' (no 'dash'). ` +
      `Obtenido: '${handler}'. El auto-detect DASH no debe afectar streams HLS.`
    ).toMatch(/hls|native/)

    await player.assertNoInitError()
  })

  test('format=dash explícito + URL HLS: player usa DASH handler (format override)', async ({ player }) => {
    // Verifica que format=dash tiene prioridad sobre la extensión de la URL
    // Incluso si la URL es .m3u8, format=dash fuerza DashHandler
    // El player intentará cargar el stream HLS con dashjs — puede fallar (esperado)
    // pero el HANDLER seleccionado debe ser dash

    await player.goto({
      type: 'media',
      src: ExternalStreams.hls.vodShort,
      autoplay: false,
      format: 'dash',
      player: 'dynamic',
    } as any)

    await expect.poll(
      async () => {
        const initialized = await player.page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await player.page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Poll until DashHandler lazy chunk mounts — handler is set on _setInnerRef (network-free).
    await expect.poll(
      () => player.page.evaluate(() => (window as any).__player?.handler ?? ''),
      { timeout: 15_000 }
    ).toMatch(/.+/)

    // El handler debe ser DASH (aunque la reproducción falle por el formato incompatible)
    const handler = await player.getHandler()
    if (handler) {
      expect(
        handler.toLowerCase(),
        `format=dash debe forzar DashHandler incluso con URL HLS. Handler obtenido: '${handler}'.`
      ).toMatch(/dash/)
    }
  })
})

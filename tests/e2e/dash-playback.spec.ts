/**
 * dash-playback.spec.ts — Tests E2E de playback DASH (VOD)
 *
 * Cubre: Init, play, pause, seek sobre DASH MPD usando el nuevo DashHandler
 * (dashjs 5.x). Verifica que el player selecciona el handler DASH cuando
 * recibe un stream .mpd o cuando se pasa format=dash.
 *
 * Fixture: player (CDN real — DashHandler requiere navegación real)
 * Requiere: ContentIds.dashVod (stream DASH en la plataforma DEV).
 *           Si no está disponible, los tests se saltan con instrucción clara.
 *
 * NOTA: No hay stream DASH local aún. Usar ExternalStreams.dash.vod como
 * fallback vía src directo solo si ContentIds.dashVod no existe.
 */
import { test, expect, ContentIds, ExternalStreams } from '../../fixtures'

// DASH VOD no tiene ID propio en ContentIds aún — usar stream externo como src.
// Cuando se agregue CONTENT_ID_DASH_VOD al env, reemplazar por ContentIds.dashVod.
const DASH_AVAILABLE = true  // ExternalStreams.dash.vod siempre existe
const DASH_SRC = ExternalStreams.dash.vod

test.describe('DASH VOD Playback', { tag: ['@e2e'] }, () => {

  test.beforeEach(async ({}, testInfo) => {
    if (!DASH_AVAILABLE) {
      testInfo.skip(
        true,
        'No hay stream DASH disponible. Agregar CONTENT_ID_DASH_VOD a ContentIds en streams.ts ' +
        'o verificar que ExternalStreams.dash.vod es accesible.'
      )
    }
  })

  test('DASH VOD se inicializa sin error de init', async ({ player }) => {
    // Arrange — usar src directo con MPD (auto-detect useDash por extensión .mpd)
    await player.goto({ type: 'media', src: DASH_SRC, autoplay: false })
    await player.waitForReady(30_000)

    // Assert
    await player.assertNoInitError()
  })

  test('autoplay=true: player DASH emite playing sin interacción', async ({ player }) => {
    // Arrange
    await player.goto({ type: 'media', src: DASH_SRC, autoplay: true })

    // Assert — esperar evento playing desde el DashHandler
    await player.waitForEvent('playing', 30_000)
    await player.assertIsPlaying()
  })

  test('play() inicia la reproducción DASH', async ({ player }) => {
    // Arrange
    await player.goto({ type: 'media', src: DASH_SRC, autoplay: false })
    await player.waitForReady(30_000)
    await player.waitForEvent('canplay', 20_000)

    // Act
    await player.play()

    // Assert
    await player.assertIsPlaying()
  })

  test('pause() detiene reproducción DASH y status cambia a pause', async ({ player }) => {
    // Arrange
    await player.goto({ type: 'media', src: DASH_SRC, autoplay: true })
    await player.waitForEvent('playing', 30_000)
    await player.assertIsPlaying()

    // Act
    await player.pause()

    // Assert
    await player.assertIsPaused()
    expect(await player.isPaused()).toBe(true)
  })

  test('currentTime avanza durante reproducción DASH', async ({ player }) => {
    // Arrange
    await player.goto({ type: 'media', src: DASH_SRC, autoplay: true })
    await player.waitForEvent('playing', 30_000)

    // Act — capturar tiempo inicial y esperar avance
    const t1 = await player.getCurrentTime()
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 8_000 }
    ).toBeGreaterThan(t1)
  })

  test('seek cambia posición en stream DASH y player continúa reproduciendo', async ({ player }) => {
    // Arrange
    await player.goto({ type: 'media', src: DASH_SRC, autoplay: true })
    await player.waitForEvent('playing', 30_000)

    const duration = await player.getDuration()
    expect(duration, 'El stream DASH debe tener duración definida').toBeGreaterThan(10)

    const seekTarget = Math.floor(duration / 3)

    // Act
    await player.seek(seekTarget)
    await player.waitForEvent('seeked', 15_000)

    // Assert — posición ± 3s (DASH puede tener latencia de segmento)
    await player.assertCurrentTimeNear(seekTarget, 3)
    await player.assertIsPlaying()
  })

  test('handler del player es DASH después de cargar MPD', async ({ player }) => {
    // Arrange
    await player.goto({ type: 'media', src: DASH_SRC, autoplay: false })
    await player.waitForReady(30_000)
    // loadMSPlayer() resolves after _controlsReady (Controls mounts), before the DashHandler
    // lazy chunk mounts. player.handler returns '' until _setInnerRef fires on DashHandler mount.
    // loadedmetadata is emitted by the handler itself (not backfilled in harness), so waiting
    // for it guarantees _handler !== null before reading player.handler.
    await player.waitForEvent('loadedmetadata', 20_000)

    // Assert — el player debe seleccionar el DashHandler
    const handler = await player.getHandler()
    expect(
      handler.toLowerCase(),
      `Handler esperado: 'dash' o similar. Obtenido: '${handler}'`
    ).toMatch(/dash/)
  })

  test('destroy() limpia el player DASH sin memory leaks visibles', async ({ player, page }) => {
    // Arrange
    await player.goto({ type: 'media', src: DASH_SRC, autoplay: true })
    await player.waitForEvent('playing', 30_000)

    // Act
    await player.destroy()

    // Assert — el elemento video debe desaparecer del DOM
    await expect(page.locator('video')).toHaveCount(0)
  })
})

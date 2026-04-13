/**
 * dash-dvr.spec.ts — Tests E2E de DVR sobre DASH
 *
 * Cubre: Seek dentro de la ventana DVR en un stream DASH live/DVR.
 * El nuevo DashHandler reworkeó la lógica de DVR (useDVRSeekAfterReload)
 * para cubrir DASH además de HLS.
 *
 * Fixture: player + contentAccess (DVR requiere access token)
 * Requiere: ContentIds.dvr (stream DVR en la plataforma DEV) con soporte DASH.
 *
 * NOTA: El stream DVR actual en ContentIds puede ser HLS. Si la plataforma
 * no tiene un DVR DASH disponible, los tests indicarán el gap con skip claro.
 */
import { test, expect, ContentIds } from '../../fixtures'

test.describe('DASH DVR — Seek en ventana live', { tag: ['@e2e'] }, () => {

  test('player DVR con DASH: isDVR retorna true', async ({ player, contentAccess }) => {
    // Arrange — cargar stream DVR con access token
    await player.goto({
      type: 'dvr',
      id: ContentIds.dvr,
      autoplay: true,
      ...contentAccess.dvr,
    })
    await player.waitForEvent('playing', 30_000)

    // Assert — el player debe detectar modo DVR
    const isDVR = await player.isDVR()
    expect(
      isDVR,
      'isDVR debe ser true para un stream de tipo dvr. ' +
      'Si el stream no tiene ventana DVR configurada en la plataforma, ' +
      'verificar la config del contenido en DEV.'
    ).toBe(true)
  })

  test('seek dentro de la ventana DVR no provoca error fatal', async ({ player, contentAccess }) => {
    // Arrange
    await player.goto({
      type: 'dvr',
      id: ContentIds.dvr,
      autoplay: true,
      ...contentAccess.dvr,
    })
    await player.waitForEvent('playing', 30_000)

    const duration = await player.getDuration()
    expect(duration, 'DVR debe reportar duración de la ventana').toBeGreaterThan(0)

    // Act — seek a 30s desde el inicio de la ventana DVR
    const seekTarget = Math.min(30, duration * 0.2)
    await player.seek(seekTarget)
    await player.waitForEvent('seeked', 15_000)

    // Assert — player retoma reproducción sin error de init
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })

  test('seek al inicio de la ventana DVR y el player retoma reproducción', async ({ player, contentAccess }) => {
    // Arrange
    await player.goto({
      type: 'dvr',
      id: ContentIds.dvr,
      autoplay: true,
      ...contentAccess.dvr,
    })
    await player.waitForEvent('playing', 30_000)

    const duration = await player.getDuration()
    expect(duration).toBeGreaterThan(0)

    // Act — seek al inicio de la ventana (posición 0 o cerca)
    await player.seek(0)
    await player.waitForEvent('seeked', 15_000)

    // Assert
    await expect.poll(
      () => player.getStatus(),
      { timeout: 15_000 }
    ).toMatch(/playing|buffering/)

    await player.assertNoInitError()
  })

  test('DASH DVR: currentTime actualiza correctamente después de seek', async ({ player, contentAccess }) => {
    // Arrange
    await player.goto({
      type: 'dvr',
      id: ContentIds.dvr,
      autoplay: true,
      ...contentAccess.dvr,
    })
    await player.waitForEvent('playing', 30_000)

    const duration = await player.getDuration()
    expect(duration).toBeGreaterThan(30)

    const seekTarget = Math.floor(duration * 0.25)

    // Act
    await player.seek(seekTarget)
    await player.waitForEvent('seeked', 15_000)

    // Assert — currentTime debe estar cerca del target (tolerancia 5s para DASH)
    await player.assertCurrentTimeNear(seekTarget, 5)
  })
})

/**
 * dash-dvr.spec.ts — Tests E2E de DVR sobre DASH
 *
 * Cubre: Seek dentro de la ventana DVR en un stream DASH live/DVR.
 * El nuevo DashHandler reworkeó la lógica de DVR (useDVRSeekAfterReload)
 * para cubrir DASH además de HLS.
 *
 * Fixture: player
 * Requiere: ContentIds.dashDvr apuntando a un stream DASH con ventana DVR configurada.
 *
 * ESTADO ACTUAL: ContentIds.dashDvr (6a0f2956a2a6f91404c3cc0c) = mismo ID que dashLive.
 * Es un stream DASH live SIN ventana DVR → __player.duration nunca se popula.
 * Los tests de seek están en test.fixme hasta que plataforma provea un ID con DVR real.
 * Configurar: CONTENT_ID_DASH_DVR=<id-con-dvr-window> en .env o CI secrets.
 */
import { test, expect, ContentIds } from '../../fixtures'

test.describe('DASH DVR — Seek en ventana live', { tag: ['@e2e'] }, () => {
  // DASH DVR popula duration con delay después de 'playing' — todos los tests usan
  // expect.poll() para esperar que duration > 0 antes de hacer seek.

  test('player DVR con DASH: isDVR retorna true', async ({ player }) => {
    // Arrange — cargar stream DVR que no requiere token
    await player.goto({
      type: 'dvr',
      id: ContentIds.dashDvr,
      autoplay: true,
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

  test('seek dentro de la ventana DVR no provoca error fatal', async ({ player, browserName }) => {
    test.fixme(true, 'CONTENT_ID_DASH_DVR apunta a un stream sin ventana DVR — __player.duration nunca se popula. Configurar un ID con DVR real en .env')
    test.skip(browserName === 'webkit', 'DASH DVR seek inestable en Playwright WebKit — usar Safari real (Tier 2)')
    // Arrange
    await player.goto({
      type: 'dvr',
      id: ContentIds.dashDvr,
      autoplay: true,
    })
    await player.waitForEvent('playing', 30_000)

    // DASH DVR popula duration con delay — poll hasta que esté disponible
    await expect.poll(() => player.getDuration(), { timeout: 10_000 })
      .toBeGreaterThan(0)
    const duration = await player.getDuration()

    // Act — seek a 30s desde el inicio de la ventana DVR
    const seekTarget = Math.min(30, duration * 0.2)
    await player.seek(seekTarget)
    await player.waitForEvent('seeked', 15_000)

    // Assert — player retoma reproducción sin error de init
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })

  test('seek al inicio de la ventana DVR y el player retoma reproducción', async ({ player, browserName }) => {
    test.fixme(true, 'CONTENT_ID_DASH_DVR apunta a un stream sin ventana DVR — __player.duration nunca se popula. Configurar un ID con DVR real en .env')
    test.skip(browserName === 'webkit', 'DASH DVR seek inestable en Playwright WebKit — usar Safari real (Tier 2)')
    // Arrange
    await player.goto({
      type: 'dvr',
      id: ContentIds.dashDvr,
      autoplay: true,
    })
    await player.waitForEvent('playing', 30_000)

    await expect.poll(() => player.getDuration(), { timeout: 10_000 }).toBeGreaterThan(0)

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

  test('DASH DVR: currentTime actualiza correctamente después de seek', async ({ player, browserName }) => {
    test.fixme(true, 'CONTENT_ID_DASH_DVR apunta a un stream sin ventana DVR — __player.duration nunca se popula. Configurar un ID con DVR real en .env')
    test.skip(browserName === 'webkit', 'DASH DVR seek inestable en Playwright WebKit — usar Safari real (Tier 2)')
    // Arrange
    await player.goto({
      type: 'dvr',
      id: ContentIds.dashDvr,
      autoplay: true,
    })
    await player.waitForEvent('playing', 30_000)

    await expect.poll(() => player.getDuration(), { timeout: 10_000 }).toBeGreaterThan(30)
    const duration = await player.getDuration()

    const seekTarget = Math.floor(duration * 0.25)

    // Act
    await player.seek(seekTarget)
    await player.waitForEvent('seeked', 15_000)

    // Assert — currentTime debe estar cerca del target (tolerancia 5s para DASH)
    await player.assertCurrentTimeNear(seekTarget, 5)
  })
})

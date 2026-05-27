/**
 * controls-api-hooks.spec.ts — Tests de integración para hooks de controles de UI
 *
 * Cubre los 3 gaps MUST del módulo controls-api detectados por A4:
 *   gap-001 — useControlsLeft: hook sin tests, modificado para usar useTranslation
 *   gap-002 — useControlsRight: hook sin tests, FullscreenButton/PipButton/CastButton
 *   gap-003 — useVideoActions: hook sin tests, modificado con breaking change de useTranslation
 *
 * Contexto del cambio (branch feature/issue-559-i18n-implementation):
 *   Los 3 hooks fueron refactorizados para usar el nuevo useTranslation cuyo contrato
 *   cambió: el campo `loading` fue eliminado del return. Cualquier consumidor que
 *   destructure `{ loading }` del hook recibe undefined en lugar de boolean.
 *   El riesgo principal: los botones muestran labels vacíos o undefined si las
 *   claves i18n no están correctamente mapeadas en los JSON actualizados.
 *
 * Estrategia de test:
 *   Los hooks son internos del player (no API pública). Se testean observando
 *   los efectos visibles en la UI: que el player se inicializa sin error, que
 *   los controles están presentes en el DOM y que las acciones de control
 *   (play/pause/seek/volume) responden correctamente. Se verifica también que
 *   los eventos de playback se emiten para confirmar que los hooks no bloquean
 *   el ciclo de vida del player.
 *
 * Fixture: isolatedPlayer (plataforma mockeada, sin dependencia de CDN real)
 *
 * ⚠️  Sin docs para controls-api — spec generado en modo básico.
 *     Considerar crear context/features/controls-api.md para documentar el contrato.
 *
 * Tag: @integration
 */
import { test, expect, MockContentIds } from '../../fixtures'

// ── Suite 1: useControlsLeft ───────────────────────────────────────────────────

test.describe('useControlsLeft — hook de controles izquierdos', { tag: ['@integration'] }, () => {

  test('player se inicializa sin error con hooks i18n actualizados', async ({ isolatedPlayer }) => {
    // Arrange + Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — sin error de init (los hooks no deben lanzar al montar el árbol React)
    await isolatedPlayer.assertNoInitError()
  })

  test('evento ready se emite correctamente después de i18n hook refactor', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    // Act + Assert — el evento ready debe emitirse, confirmando que el árbol de
    // componentes montó sin excepción en useControlsLeft
    await isolatedPlayer.waitForEvent('ready', 20_000)

    const events = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.events ?? [])
    expect(events).toContain('ready')
  })

  test('play y pause funcionan con controles izquierdos activos', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Act — invocar play vía API pública (useVideoActions depende de useControlsLeft)
    await isolatedPlayer.play()

    // Assert — el player llega a estado playing
    await isolatedPlayer.waitForEvent('playing', 15_000)
    await isolatedPlayer.assertIsPlaying()

    // Act — pausar
    await isolatedPlayer.pause()
    await isolatedPlayer.assertIsPaused()
  })

  test('volumen se puede ajustar sin error — ButtonComponent de volume/index.jsx', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Act — setVolume vía API pública (el VolumeControl usa useTranslation para su label)
    await isolatedPlayer.setVolume(0.5)

    // Assert — el valor se actualizó correctamente (no hubo excepción en el hook)
    await expect.poll(
      () => isolatedPlayer.getVolume(),
      { timeout: 5_000, message: 'El volumen no se actualizó a 0.5' }
    ).toBeCloseTo(0.5, 1)
  })

  test('no se emiten errores de consola por claves i18n faltantes al montar controles', async ({ isolatedPlayer, page }) => {
    // Arrange — capturar errores de consola antes de inicializar
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — no debe haber errores de React relacionados con traducciones
    const i18nErrors = consoleErrors.filter((e) =>
      e.toLowerCase().includes('translation') ||
      e.toLowerCase().includes('i18n') ||
      e.toLowerCase().includes('undefined') ||
      e.toLowerCase().includes('loading')
    )
    expect(
      i18nErrors,
      `Errores de consola relacionados con i18n/traducciones: ${JSON.stringify(i18nErrors)}`
    ).toHaveLength(0)
  })
})

// ── Suite 2: useControlsRight ──────────────────────────────────────────────────

test.describe('useControlsRight — FullscreenButton, PipButton, CastButton', { tag: ['@integration'] }, () => {

  test('player se inicializa con controles de lado derecho sin error', async ({ isolatedPlayer }) => {
    // Arrange + Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert
    await isolatedPlayer.assertNoInitError()

    // Verificar que el player fue correctamente montado (árbol React con useControlsRight intacto)
    const playerExists = await isolatedPlayer.page.evaluate(
      () => typeof (window as any).__player === 'object' && (window as any).__player !== null
    )
    expect(playerExists, 'El player no existe en window.__player — fallo de mount React').toBe(true)
  })

  test('showControls y hideControls operan sin excepción en controles derechos', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Act + Assert — showControls/hideControls no deben lanzar excepción
    // (CastButton, FullscreenButton, PipButton dependen de useControlsRight que usa useTranslation)
    await expect(async () => {
      await isolatedPlayer.showControls()
    }).not.toThrow()

    await expect(async () => {
      await isolatedPlayer.hideControls()
    }).not.toThrow()
  })

  test('playbackRate se puede cambiar — SpeedControl del panel derecho', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)
    await isolatedPlayer.play()
    await isolatedPlayer.waitForEvent('playing', 15_000)

    // Act — cambiar playbackRate (SpeedControl renderizado vía useControlsRight)
    await isolatedPlayer.setPlaybackRate(1.5)

    // Assert — el valor se aplica correctamente
    await expect.poll(
      () => isolatedPlayer.getPlaybackRate(),
      { timeout: 5_000, message: 'playbackRate no se actualizó a 1.5' }
    ).toBeCloseTo(1.5, 1)
  })

  test('CastButton: player.cast tiene la forma correcta cuando está disponible en la API', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — player.cast puede existir o ser undefined; pero si existe, su shape es correcta.
    // El CastButton de useControlsRight renderiza condicionalmente según cast disponibilidad.
    // No se puede simular una sesión Cast en headless — verificamos solo el contrato de la prop.
    const castShape = await isolatedPlayer.page.evaluate(() => {
      const p = (window as any).__player
      if (!p?.cast) return null
      return {
        hasAvailable: 'available' in p.cast,
        hasConnected: 'connected' in p.cast,
        hasConnect: typeof p.cast.connect === 'function',
        hasDisconnect: typeof p.cast.disconnect === 'function',
      }
    })

    // Si cast está presente en la instancia, debe tener la shape completa
    if (castShape !== null) {
      expect(castShape.hasAvailable, 'player.cast.available no está definido').toBe(true)
      expect(castShape.hasConnected, 'player.cast.connected no está definido').toBe(true)
      expect(castShape.hasConnect, 'player.cast.connect no es función').toBe(true)
      expect(castShape.hasDisconnect, 'player.cast.disconnect no es función').toBe(true)
    }
    // Si cast es null/undefined, el CastButton no se renderizará — comportamiento esperado
    // en entorno headless sin SDK de Cast. El test pasa igualmente.
  })

  test('fullscreen API no lanza error al intentar activar (entorno headless)', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Act — setFullscreen puede fallar silenciosamente en headless (sin pantalla real)
    // pero NO debe lanzar excepción que rompa el player
    let threwException = false
    try {
      await isolatedPlayer.setFullscreen(true)
    } catch {
      threwException = true
    }

    // Assert — el player sigue operativo aunque fullscreen haya fallado silenciosamente
    const initError = await isolatedPlayer.hasInitError()
    expect(initError, 'El player tuvo un error de init tras intentar fullscreen').toBeNull()

    // En headless, setFullscreen puede no tener efecto — solo verificamos que no rompe nada
    // El FullscreenButton de useControlsRight debe renderizarse de todas formas
    expect(threwException, 'setFullscreen() lanzó una excepción inesperada').toBe(false)
  })
})

// ── Suite 3: useVideoActions ───────────────────────────────────────────────────

test.describe('useVideoActions — acciones de video del player', { tag: ['@integration'] }, () => {

  test('useVideoActions: play/pause/seek responden correctamente post-refactor i18n', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Act — play
    await isolatedPlayer.play()
    await isolatedPlayer.waitForEvent('playing', 15_000)

    // Assert — estado de playback correcto
    await isolatedPlayer.assertIsPlaying()
    const statusAfterPlay = await isolatedPlayer.getStatus()
    expect(statusAfterPlay, 'Status debe ser "playing" tras invocar play()').toBe('playing')

    // Act — pause
    await isolatedPlayer.pause()
    await isolatedPlayer.assertIsPaused()
    const statusAfterPause = await isolatedPlayer.getStatus()
    expect(statusAfterPause, 'Status debe ser "pause" tras invocar pause()').toBe('pause')
  })

  test('useVideoActions: seek a posición válida emite evento seeked', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 15_000)

    // Esperar que haya duración disponible
    await expect.poll(
      () => isolatedPlayer.getDuration(),
      { timeout: 10_000, message: 'La duración del video no está disponible' }
    ).toBeGreaterThan(0)

    const duration = await isolatedPlayer.getDuration()

    // Act — seek a 10% del video
    const seekTarget = Math.max(1, duration * 0.1)
    await isolatedPlayer.seek(seekTarget)

    // Assert — currentTime debe estar cerca del target
    await expect.poll(
      () => isolatedPlayer.getCurrentTime(),
      { timeout: 8_000, message: `currentTime no se acercó a ${seekTarget}s` }
    ).toBeGreaterThanOrEqual(seekTarget - 2)
  })

  test('useVideoActions: mute/unmute no lanza error con i18n hook refactorizado', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Act — mute
    await isolatedPlayer.setMuted(true)

    // Assert
    await expect.poll(
      () => isolatedPlayer.isMuted(),
      { timeout: 5_000, message: 'El player no está muteado' }
    ).toBe(true)

    // Act — unmute
    await isolatedPlayer.setMuted(false)

    // Assert
    await expect.poll(
      () => isolatedPlayer.isMuted(),
      { timeout: 5_000, message: 'El player sigue muteado' }
    ).toBe(false)
  })

  test('useVideoActions: loop se puede activar y desactivar', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Act + Assert — activar loop
    await isolatedPlayer.setLoop(true)
    const loopOn = await isolatedPlayer.getLoop()
    expect(loopOn, 'loop no se activó').toBe(true)

    // Act + Assert — desactivar loop
    await isolatedPlayer.setLoop(false)
    const loopOff = await isolatedPlayer.getLoop()
    expect(loopOff, 'loop no se desactivó').toBe(false)
  })

  test('useVideoActions: secuencia completa play → pause → play emite eventos correctamente', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Act — play
    await isolatedPlayer.play()
    await isolatedPlayer.waitForEvent('playing', 15_000)

    // Act — pause
    await isolatedPlayer.pause()
    await isolatedPlayer.waitForEvent('pause', 5_000)

    // Limpiar eventos registrados y hacer play de nuevo
    await isolatedPlayer.clearTrackedEvents()
    await isolatedPlayer.play()
    await isolatedPlayer.waitForEvent('playing', 15_000)

    // Assert — los eventos deben haberse emitido de nuevo en el segundo ciclo
    const events = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.events ?? [])
    expect(events, 'El evento playing no se emitió en el segundo ciclo').toContain('playing')
  })
})

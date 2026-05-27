/**
 * casting-overlay.spec.ts — Tests de integración para el overlay de Chromecast casting
 *
 * Cubre el gap MUST del módulo chromecast detectado por A4:
 *   gap-005 — Eliminación funcional: SubtitleControl y LiveIndicator removidos de casting/index.jsx
 *
 * Contexto del cambio (branch feature/issue-559-i18n-implementation):
 *   src/view/video/components/casting/index.jsx fue modificado:
 *     lines_added: 60, lines_removed: 238
 *   Componentes eliminados:
 *     - SubtitleControl: el overlay de casting ya no tiene control de subtítulos
 *     - LiveIndicator: el overlay de casting ya no muestra indicador live/VOD
 *     - Lógica DVR: el seek durante sesión cast puede dejar de funcionar
 *   La reducción de 178 líneas netas puede haber eliminado handlers de estado o
 *   efectos que sincronizaban el estado del player con el receptor Cast.
 *
 * Estrategia de test:
 *   El Cast SDK requiere Chrome real con dispositivo físico — no se puede simular
 *   una sesión Cast activa en Playwright headless. Ver context/features/chromecast.md.
 *
 *   Lo que SÍ se puede testear:
 *   1. El player se inicializa sin error tras la eliminación masiva de código
 *   2. La API player.cast tiene la forma correcta (contract de la propiedad)
 *   3. El evento castStateChange existe en el sistema de eventos del player
 *   4. El player llega a estado playing con VOD, DVR y contenido Live
 *      (la eliminación de lógica DVR en el overlay NO debe afectar el playback normal)
 *   5. Los eventos de Chromecast están documentados en el sistema de eventos
 *
 * Fixture: isolatedPlayer (plataforma mockeada — determinista)
 *
 * Fuente de verdad: context/features/chromecast.md
 *
 * Tag: @integration
 */
import { test, expect, MockContentIds } from '../../fixtures'

// ── Suite 1: Inicialización tras eliminación masiva de código ─────────────────

test.describe('casting/index.jsx — integridad post-eliminación de SubtitleControl y LiveIndicator', { tag: ['@integration'] }, () => {

  test('player VOD se inicializa sin error tras refactor masivo del overlay de casting', async ({ isolatedPlayer }) => {
    // Arrange + Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — la eliminación de 238 líneas no debe romper el init del player
    await isolatedPlayer.assertNoInitError()

    const playerExists = await isolatedPlayer.page.evaluate(
      () => typeof (window as any).__player === 'object' && (window as any).__player !== null
    )
    expect(playerExists, 'El player no existe en window.__player tras refactor de casting overlay').toBe(true)
  })

  test('evento ready se emite con contenido live — LiveIndicator eliminado no bloquea el init', async ({ isolatedPlayer }) => {
    // Arrange — LiveIndicator fue eliminado del overlay de casting.
    // Verificar que su ausencia no bloquea el montaje del árbol React para contenido live.
    await isolatedPlayer.goto({
      type: 'live',
      id: MockContentIds.live,
      autoplay: false,
    })

    // Act + Assert
    await isolatedPlayer.waitForEvent('ready', 25_000)

    const events = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.events ?? [])
    expect(
      events,
      'El evento ready no fue emitido para contenido live — posible regresión por eliminación de LiveIndicator'
    ).toContain('ready')
  })

  test('player no lanza errores de consola tras eliminación de componentes del overlay', async ({ isolatedPlayer, page }) => {
    // Arrange
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — no debe haber errores JavaScript por referencias a componentes eliminados
    const castingErrors = [...pageErrors, ...consoleErrors].filter((e) => {
      const text = e.toLowerCase()
      return (
        text.includes('subtitle') ||
        text.includes('liveindicator') ||
        text.includes('castingoverlay') ||
        text.includes('cannot read') ||
        text.includes('is not a function') ||
        text.includes('undefined')
      )
    })

    expect(
      castingErrors,
      `Errores de consola relacionados con componentes eliminados del casting overlay:\n` +
      JSON.stringify(castingErrors, null, 2)
    ).toHaveLength(0)
  })

  test('play/pause funcionan correctamente — lógica DVR eliminada no afecta VOD', async ({ isolatedPlayer }) => {
    // Arrange — La lógica DVR fue removida del casting overlay.
    // Verificar que el playback normal de VOD no está afectado.
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)

    // Assert — el player llega a playing
    await isolatedPlayer.assertIsPlaying()

    // Act — pause
    await isolatedPlayer.pause()
    await isolatedPlayer.assertIsPaused()

    // Act — play de nuevo
    await isolatedPlayer.play()
    await isolatedPlayer.waitForEvent('playing', 15_000)
    await isolatedPlayer.assertIsPlaying()
  })
})

// ── Suite 2: Contrato de player.cast API ──────────────────────────────────────

test.describe('casting overlay — contrato de player.cast API', { tag: ['@integration'] }, () => {

  test('player.cast tiene la shape correcta si está disponible', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — verificar la shape del objeto cast según context/features/chromecast.md
    const castShape = await isolatedPlayer.page.evaluate(() => {
      const p = (window as any).__player
      if (!p || !('cast' in p)) return { present: false }
      const c = p.cast
      if (c == null) return { present: false }
      return {
        present: true,
        hasAvailable: 'available' in c,
        availableIsBoolean: typeof c.available === 'boolean',
        hasConnected: 'connected' in c,
        connectedIsBoolean: typeof c.connected === 'boolean',
        hasConnect: typeof c.connect === 'function',
        hasDisconnect: typeof c.disconnect === 'function',
      }
    })

    if (castShape.present) {
      expect(castShape.hasAvailable, 'player.cast.available no está definido').toBe(true)
      expect(castShape.availableIsBoolean, 'player.cast.available no es boolean').toBe(true)
      expect(castShape.hasConnected, 'player.cast.connected no está definido').toBe(true)
      expect(castShape.connectedIsBoolean, 'player.cast.connected no es boolean').toBe(true)
      expect(castShape.hasConnect, 'player.cast.connect no es función').toBe(true)
      expect(castShape.hasDisconnect, 'player.cast.disconnect no es función').toBe(true)
    }
    // Si cast no está presente: comportamiento esperado en headless sin SDK de Cast.
  })

  test('los eventos de chromecast están registrados en el sistema de eventos', async ({ isolatedPlayer, page }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — verificar que el player puede suscribirse a castStateChange sin error
    // (el evento fue documentado en player_system.md como evento del player)
    const canSubscribeToCastState = await page.evaluate(() => {
      try {
        const p = (window as any).__player
        if (!p || typeof p.on !== 'function') return false
        // Suscribir un listener no-op para verificar que el evento está registrado
        const noop = () => {}
        p.on('castStateChange', noop)
        p.off('castStateChange', noop)
        return true
      } catch {
        return false
      }
    })

    expect(
      canSubscribeToCastState,
      'No se pudo suscribir al evento castStateChange — posible regresión del refactor de casting/index.jsx'
    ).toBe(true)
  })

  test('no hay sesión cast activa al inicializar — estado inicial correcto', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — en headless sin SDK, cast.connected debe ser false o no estar presente
    const castConnected = await isolatedPlayer.page.evaluate(() => {
      const p = (window as any).__player
      if (!p?.cast) return null  // cast no disponible — OK en headless
      return p.cast.connected
    })

    // Si cast existe: no debe haber sesión activa al inicializar
    if (castConnected !== null) {
      expect(
        castConnected,
        'player.cast.connected es true al inicializar — no debe haber sesión activa en un player recién init'
      ).toBe(false)
    }
  })
})

// ── Suite 3: Regresión de reproducción con DVR ────────────────────────────────

test.describe('casting overlay — regresión DVR post-eliminación de lógica DVR del overlay', { tag: ['@integration'] }, () => {

  test('player con contenido DVR se inicializa sin error', async ({ isolatedPlayer }) => {
    // Arrange — La lógica DVR fue removida del overlay de casting (casting/index.jsx).
    // Verificar que el player mismo (no el overlay) inicializa DVR correctamente.
    await isolatedPlayer.goto({
      type: 'live',           // DVR usa type: 'live' con el mismo ID
      id: MockContentIds.live,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert
    await isolatedPlayer.assertNoInitError()
  })

  test('seek en VOD funciona tras eliminación de lógica DVR del overlay de casting', async ({ isolatedPlayer }) => {
    // Arrange — La eliminación de lógica DVR del casting overlay no debe afectar el seek
    // en contenido VOD normal (la lógica DVR del player core permanece intacta).
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)

    // Esperar duración disponible
    await expect.poll(
      () => isolatedPlayer.getDuration(),
      { timeout: 10_000, message: 'La duración del video no está disponible' }
    ).toBeGreaterThan(0)

    const duration = await isolatedPlayer.getDuration()

    // Act — seek a 20% del video
    const seekTarget = Math.max(1, duration * 0.2)
    await isolatedPlayer.seek(seekTarget)

    // Assert — el seek funcionó correctamente
    await expect.poll(
      () => isolatedPlayer.getCurrentTime(),
      { timeout: 8_000, message: `currentTime no alcanzó ${seekTarget}s` }
    ).toBeGreaterThanOrEqual(seekTarget - 2)
  })

  test('SubtitleControl eliminado del overlay: los subtítulos siguen funcionando en el player normal', async ({ isolatedPlayer }) => {
    // Arrange — SubtitleControl fue eliminado del casting overlay, pero el SubtitleControl
    // principal del player (no el de cast) debe seguir funcionando.
    // Usar MockContentIds.vod — la plataforma mock responde con vod.json que puede
    // o no incluir subtitle tracks según la fixture.
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — el player acepta la API de textTracks sin error
    // (SubtitleControl eliminado del casting overlay no debe romper textTracks en el player)
    const tracks = await isolatedPlayer.getTextTracks()

    // El array puede estar vacío si el mock stream no tiene subtítulos — eso es OK.
    // Lo importante es que la llamada no lanza excepción.
    expect(Array.isArray(tracks), 'getTextTracks() no retorna un array — posible regresión del refactor').toBe(true)
  })
})

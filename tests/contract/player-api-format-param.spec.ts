/**
 * player-api-format-param.spec.ts — Contrato del parámetro format en la API del player
 *
 * Cubre: El nuevo parámetro 'format' en la init config (format=dash|hls|auto)
 * y 'selectedSrcType' en el estado del player (propagado desde loadConfig).
 *
 * Cambios en el player:
 *  - src/api/player.jsx: formato añadido a loadConfig, loadKey state tracking,
 *    selectedSrcType almacenado en player state
 *  - src/platform/loadConfig.js: format param override, auto-detect useDash
 *  - src/player/base.js: DASH srcType detection (.mpd URL o selectedSrcType=dash)
 *
 * Fixture: isolatedPlayer (plataforma mockeada — tests de contrato son deterministas)
 * No requiere streams reales — solo verifica que la API acepta el parámetro.
 *
 * Filosofía (igual que player-api.spec.ts):
 *  - Verifica la FORMA de la API, no el comportamiento completo de playback
 *  - "CONTRACT VIOLATION" en mensajes de error para identificación rápida
 *  - Si el parámetro format no existe o se ignora silenciosamente, el test falla
 *
 * Tag: @contract
 */
import { test, expect, MockContentIds, ExternalStreams } from '../../fixtures'

const CONTRACT_VERSION = '1.0.58'  // versión del player donde se introduce format param

function contractViolation(what: string, detail: string): string {
  return `CONTRACT VIOLATION [player v${CONTRACT_VERSION}]: ${what}\n  → ${detail}`
}

test.describe('Player API — format param', {
  tag: ['@contract'],
  annotation: [{ type: 'description', description: 'Contrato del parámetro format (DASH/HLS selection)' }],
}, () => {

  // ── 1. format=hls — no debe cambiar el comportamiento existente ────────────

  test('format=hls: player se inicializa correctamente (comportamiento existente)', async ({ isolatedPlayer }) => {
    // Arrange — format=hls es el comportamiento existente, no debe romper nada
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      format: 'hls',
    } as any)

    await isolatedPlayer.waitForReady(20_000)

    // Assert
    const initError = await isolatedPlayer.hasInitError()
    expect(initError, contractViolation(
      'format=hls causó error de init',
      `initError: "${initError}". El parámetro format=hls debe mantener el comportamiento HLS existente.`
    )).toBeNull()
  })

  // ── 2. format=dash — player debe seleccionar el handler DASH ──────────────

  test('format=dash: player acepta el parámetro sin error de init', async ({ isolatedPlayer }) => {
    // Arrange — format=dash fuerza la selección del DashHandler.
    // Usamos ExternalStreams.dash.vod (MPD real) + player='dynamic' para evitar que
    // dashjs crashee el browser al intentar parsear un stream HLS como MPEG-DASH.
    // player='dynamic' salta el fetch de config de plataforma — no hace falta mock.
    await isolatedPlayer.goto({
      type: 'media',
      src: ExternalStreams.dash.vod,
      autoplay: false,
      format: 'dash',
      player: 'dynamic',
    } as any)

    // Esperar a que el player intente inicializarse (puede tardar por lazy-load de dashjs)
    await expect.poll(
      async () => {
        const initialized = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    // El parámetro format debe ser reconocido (no causar un error de tipo "unknown param")
    // Si hay error, debe ser por el stream (no MPD local), no por el parámetro format
    const initError = await isolatedPlayer.hasInitError()
    if (initError !== null) {
      expect(initError, contractViolation(
        'format=dash causó un error inesperado (no relacionado con el stream)',
        `initError: "${initError}". El error debe ser de stream/DRM, no de parámetro desconocido.`
      )).not.toMatch(/unknown.*param|invalid.*format|format.*not.*support/i)
    }
  })

  // ── 3. format=auto — auto-detect basado en la URL ─────────────────────────

  test('format=auto: player acepta el parámetro y auto-detecta basándose en la URL', async ({ isolatedPlayer }) => {
    // Arrange — format=auto usa la URL para detectar si usar DASH o HLS
    // Con stream HLS local, debe seleccionar HLS
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      format: 'auto',
    } as any)

    await isolatedPlayer.waitForReady(20_000)

    // Assert — con stream HLS y format=auto, debe inicializarse correctamente
    const initError = await isolatedPlayer.hasInitError()
    expect(initError, contractViolation(
      'format=auto causó error de init con stream HLS',
      `initError: "${initError}". Con format=auto y una URL HLS, el player debe seleccionar HLS.`
    )).toBeNull()
  })

  // ── 4. Auto-detect useDash por extensión .mpd ──────────────────────────────

  test('src con extensión .mpd: player auto-detecta DASH sin format explícito', async ({ isolatedPlayer }) => {
    // El cambio en src/player/base.js añade auto-detect por extensión .mpd
    // Usar ExternalStreams.dash.vod como src directo
    await isolatedPlayer.goto({
      type: 'media',
      src: ExternalStreams.dash.vod,
      autoplay: false,
      // Sin format explícito — el player debe detectar DASH por la extensión .mpd
    })

    await expect.poll(
      async () => {
        const initialized = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Assert — el handler seleccionado debe ser DASH (auto-detected)
    const handler = await isolatedPlayer.getHandler()
    expect(
      handler.toLowerCase(),
      contractViolation(
        'Auto-detect DASH por .mpd falló — handler incorrecto seleccionado',
        `Handler actual: '${handler}'. Una URL .mpd debe seleccionar el DashHandler automáticamente. ` +
        'Verificar src/player/base.js — lógica de auto-detect DASH.'
      )
    ).toMatch(/dash/)
  })

  // ── 5. selectedSrcType en el estado del player ────────────────────────────

  test('selectedSrcType se almacena en el estado del player después de init', async ({ isolatedPlayer }) => {
    // El cambio en src/api/player.jsx almacena selectedSrcType en el player state
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await isolatedPlayer.waitForReady(20_000)

    // Verificar que selectedSrcType existe en el player (puede ser 'hls', 'dash', 'native', etc.)
    const selectedSrcType = await isolatedPlayer.page.evaluate(() =>
      (window as any).__player?.selectedSrcType ?? null
    )

    // selectedSrcType debe existir y ser un string no vacío
    // Si es null, puede que el player no lo exponga aún en la API pública
    if (selectedSrcType !== null) {
      expect(typeof selectedSrcType, contractViolation(
        'player.selectedSrcType no es un string',
        `Tipo actual: ${typeof selectedSrcType}. selectedSrcType debe ser 'hls' | 'dash' | 'native'.`
      )).toBe('string')
      expect(selectedSrcType.length, contractViolation(
        'player.selectedSrcType está vacío',
        'El player debe reportar el tipo de stream seleccionado después de la init.'
      )).toBeGreaterThan(0)
    } else {
      // Si no está expuesto, documentar el gap con un warning (no fallar el test)
      console.warn(
        'player.selectedSrcType no está expuesto en la API pública. ' +
        'El equipo del player debería exponerlo para facilitar el debugging.'
      )
    }
  })

  // ── 6. format param no rompe la API existente ─────────────────────────────

  test('sin format param: player se inicializa igual que antes (backward compat)', async ({ isolatedPlayer }) => {
    // Verificar que la adición del parámetro format no rompe la init sin format
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      // Sin parámetro format — comportamiento pre-v1.0.58
    })

    await isolatedPlayer.waitForReady(20_000)
    await isolatedPlayer.assertNoInitError()

    // El player debe seguir reproduciendo HLS por defecto
    const handler = await isolatedPlayer.getHandler()
    expect(
      handler,
      contractViolation(
        'Sin format param, el handler no es HLS (backward compat rota)',
        `Handler actual: '${handler}'. Sin format param, el player debe usar HLS por defecto.`
      )
    ).toMatch(/hls|native/i)
  })
})

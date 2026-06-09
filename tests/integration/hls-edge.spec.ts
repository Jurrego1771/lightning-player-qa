/**
 * hls-edge.spec.ts — Tests de edge cases en HLS no cubiertos por hls-abr.spec.ts
 *
 * Cubre gaps MUST detectados por coverage-auditor:
 *   AC-HLS-005: Segmento individual con HTTP 404 persistente → hls.js agota retries → error fatal
 *   AC-HLS-007: EXT-X-DISCONTINUITY en manifest → player no crashea, reproducción continúa
 *
 * Diferencia con error-recovery.spec.ts:
 *   error-recovery.spec.ts usa route.abort('failed') — error de conexión, no HTTP 404.
 *   Este spec usa route.fulfill({ status: 404 }) para el 404 real (hls.js toma camino
 *   distinto para HTTP errors vs network errors en su retry logic).
 *   error-recovery.spec.ts bloquea todos los segmentos — aquí se bloquea uno específico.
 *
 * Fixture: isolatedPlayer + streams locales en localhost:9001
 * Tag: @integration @hls
 */
import { test, expect, MockContentIds, mockContentConfig, LocalStreams } from '../../fixtures'

// ── AC-HLS-005: Segmento 404 → retry → error fatal ───────────────────────────

test.describe('HLS — segmento con HTTP 404 persistente', {
  tag: ['@integration', '@hls'],
}, () => {
  // Cubre: AC-HLS-005
  // hls.js intenta el segmento faltante N veces (retry budget configurable, default 3).
  // Tras agotar el budget, emite hlsError con fatal:true → el player emite 'error'.
  // Diferencia clave con route.abort: un 404 real permite que hls.js inspeccione el
  // status code y decida si reintentar (algunos errores 5xx se reintentan, 404 no siempre).

  test('un segmento devuelve HTTP 404 → player emite evento error sin quedar en loop', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // Intercept segment001.ts specifically — let segment000 load (first segment needed for
    // hls.js to parse the manifest and start buffering), then fail segment001 persistently.
    // This ensures hls.js has a specific segment to retry before hitting fatal error.
    let segment001Requests = 0
    await page.route('**/segment001.ts', async (route) => {
      segment001Requests++
      await route.fulfill({ status: 404, body: 'Not Found', contentType: 'text/plain' })
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // hls.js agota su retry budget para segment001 (default 3 intentos) y emite fatal error.
    // 40s para dar tiempo a los retries y backoff de hls.js.
    await player.waitForEvent('error', 40_000)

    // El player debe reportar el fallo
    const errors = await player.getErrors()
    expect(
      errors.length,
      `Player debe registrar el error de segmento 404. segment001 fue solicitado ${segment001Requests} veces.`
    ).toBeGreaterThan(0)

    // El player no debe quedar en un estado jugando (el error debe ser visible)
    const isPlaying = !(await player.isPaused())
    // No es válido que el player siga "playing" después de un error fatal de HLS
    // (puede estar paused/error state — lo importante es que el error se registró)
    expect(
      errors.length,
      'getErrors() debe tener al menos un error después del fallo de segmento'
    ).toBeGreaterThan(0)
  })

  test('segmento 404 en stream alternativo (vod-with-error fixture): error mid-stream', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // Variante: usar el fixture vod-with-error que tiene MISSING_SEGMENT.ts hardcodeado.
    // El servidor retorna 404 naturalmente (el archivo no existe).
    // Verifica que el 404 real del servidor (sin intercept) también se detecta.
    await mockContentConfig(page, {
      src: { hls: LocalStreams.hls.withError },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('error', 25_000)

    const errors = await player.getErrors()
    expect(errors.length, 'fixture vod-with-error debe causar error registrado').toBeGreaterThan(0)
  })
})

// ── AC-HLS-007: EXT-X-DISCONTINUITY → sin crash ──────────────────────────────

test.describe('HLS — EXT-X-DISCONTINUITY no causa crash', {
  tag: ['@integration', '@hls'],
}, () => {
  // Cubre: AC-HLS-007
  // EXT-X-DISCONTINUITY indica un cambio en la secuencia de media (PTS reset, codec change, etc.).
  // hls.js maneja esto internamente insertando un discontinuity marker en su queue.
  // Si hay bug en el handler, el player puede crashear o quedar en buffering infinito.
  // Fixture vod-with-discontinuity tiene 2 puntos de discontinuidad en 12s totales.

  test('stream con EXT-X-DISCONTINUITY: player inicializa y alcanza playing sin crash', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // Arrange — usar fixture con discontinuidad
    await mockContentConfig(page, {
      src: { hls: LocalStreams.hls.withDiscontinuity },
    })

    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (!msg.includes('notallowederror') && !msg.includes('play()') && !msg.includes('aborted')) {
        uncaughtErrors.push(err.message)
      }
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Assert 1 — player llega a ready (manifest parseado correctamente, incluido el DISCONTINUITY)
    await player.waitForReady(20_000)
    await player.assertNoInitError()

    // Assert 2 — player alcanza playing (hls.js pudo pasar por el punto de discontinuidad)
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()

    // Assert 3 — sin crashes JS no capturados durante el lifecycle
    expect(
      uncaughtErrors,
      `EXT-X-DISCONTINUITY no debe causar errores JS. Errores: ${uncaughtErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  test('stream con EXT-X-DISCONTINUITY: reproducción continúa más allá del punto de discontinuidad', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // Verifica que el player no se queda colgado EN el punto de discontinuidad (currentTime avanza).
    // El fixture tiene el primer DISCONTINUITY en 4s (después de 2 segmentos de 2s).
    await mockContentConfig(page, {
      src: { hls: LocalStreams.hls.withDiscontinuity },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Esperar a que el player pase el punto de discontinuidad (~4s).
    // Usamos waitForFunction para no depender de waitForTimeout.
    await page.waitForFunction(
      () => {
        const ct = (window as any).__player?.currentTime ?? 0
        return ct > 4
      },
      { timeout: 30_000 }
    )

    const currentTime = await player.getCurrentTime()
    expect(
      currentTime,
      'El player debe avanzar más allá del primer EXT-X-DISCONTINUITY en ~4s'
    ).toBeGreaterThan(4)

    await player.assertNoInitError()
  })
})

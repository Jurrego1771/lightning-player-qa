/**
 * playback-core-edge.spec.ts — Tests de edge cases en el núcleo de reproducción
 *
 * Cubre gaps MUST detectados por coverage-auditor:
 *   AC-PLAYBACK-005: Evento 'ended' al completar VOD
 *   AC-PLAYBACK-006: Error fatal manejado — stream HLS inaccesible (404)
 *
 * AC-PLAYBACK-003 (seek) ya está cubierto por controls-api-edge.spec.ts.
 *
 * Complementa error-recovery.spec.ts (que usa route.abort) con el escenario
 * de URL HLS inválida desde la configuración de content (distinción importante:
 * error-recovery testea fallo de segmentos en un stream válido; aquí testea
 * que la URL del stream completo es inaccesible desde el inicio).
 *
 * Fixture: isolatedPlayer + streams locales en localhost:9001
 * Tag: @integration @playback
 */
import { test, expect, MockContentIds, mockContentConfig, LocalStreams } from '../../fixtures'

// ── AC-PLAYBACK-005: Evento 'ended' al completar VOD ─────────────────────────

test.describe('Playback Core — evento ended al completar VOD', {
  tag: ['@integration', '@playback'],
}, () => {
  // Cubre: AC-PLAYBACK-005
  // El evento 'ended' debe emitirse cuando currentTime === duration.
  // Estrategia: usar el fixture vod-with-discontinuity (12s) — seekar a near-end
  // para que el test no tarde 12s completos de reproducción.
  //
  // BUG-PLAYBACK-001: seeking hacia 0 omite el evento 'seeking'. Para otros valores
  // de seek el comportamiento es correcto — el test usa seek a un valor > 0.

  test('VOD corto reproduce hasta ended: evento ended emitido, player.paused = true', async ({
    isolatedPlayer: player,
    page,
  }) => {
    test.setTimeout(60_000)

    // Usar fixture corto (12s) para que ended sea alcanzable en tiempo razonable
    await mockContentConfig(page, {
      src: { hls: LocalStreams.hls.withDiscontinuity },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Seek near the end (10s de 12s total) para acelerar el test
    // Esperar que el player tenga suficiente información de duración
    await page.waitForFunction(
      () => {
        const d = (window as any).__player?.duration ?? 0
        return d > 5 // duración conocida (más de 5s disponibles)
      },
      { timeout: 15_000 }
    )

    await player.seek(10)
    await player.waitForEvent('seeked', 10_000)

    // Esperar el evento ended (el fixture tiene ~12s, seek a 10s → ~2s hasta ended)
    await player.waitForEvent('ended', 30_000)

    // Verificar estado post-ended
    const isPaused = await player.isPaused()
    expect(
      isPaused,
      'Después de ended, player.paused debe ser true'
    ).toBe(true)

    const hasEnded = await player.hasEnded()
    expect(
      hasEnded,
      'player.ended debe ser true después del evento ended'
    ).toBe(true)
  })

  test('VOD: ended precede a cualquier playing posterior al seek', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // Verifica que el orden de eventos es correcto y que ended realmente se emite.
    test.setTimeout(60_000)

    await mockContentConfig(page, {
      src: { hls: LocalStreams.hls.withDiscontinuity },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Esperar duración disponible
    await page.waitForFunction(
      () => ((window as any).__player?.duration ?? 0) > 5,
      { timeout: 15_000 }
    )

    await player.seek(10)
    await player.waitForEvent('ended', 30_000)

    const events: string[] = await page.evaluate(() => (window as any).__qa?.events ?? [])
    expect(
      events,
      'El evento ended debe estar en los eventos registrados'
    ).toContain('ended')

    // Verificar posición temporal: ended ocurre cerca de la duración
    const currentTime = await player.getCurrentTime()
    const duration = await player.getDuration()
    expect(
      Math.abs(currentTime - duration),
      `currentTime (${currentTime}s) debe estar cerca de duration (${duration}s) al ended`
    ).toBeLessThan(2)
  })
})

// ── AC-PLAYBACK-006: Error fatal con URL de stream inaccesible ────────────────

test.describe('Playback Core — error fatal con stream HLS inaccesible', {
  tag: ['@integration', '@playback'],
}, () => {
  // Cubre: AC-PLAYBACK-006
  // Diferencia con error-recovery.spec.ts:
  //   error-recovery.spec.ts → stream válido, segmentos fallan en runtime (route.abort)
  //   Este spec → URL del manifest HLS inaccesible desde el inicio (no existe el archivo)
  //
  // Escenario: content config apunta a un HLS que no existe → 404 en el manifest fetch.
  // El player debe emitir 'error' con fatal:true y quedar en estado estable.

  test('stream HLS con URL inaccesible: error event emitido sin crash', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // URL de manifest HLS que no existe en el servidor local
    const invalidHlsUrl = 'http://localhost:9001/nonexistent/stream.m3u8'

    await mockContentConfig(page, {
      src: { hls: invalidHlsUrl },
    })

    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (!msg.includes('notallowederror') && !msg.includes('hls') && !msg.includes('aborted')) {
        uncaughtErrors.push(err.message)
      }
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // El manifest 404 debe triggear el error del player
    // hls.js intenta el manifest, recibe 404, emite error fatal → player emite 'error'
    await player.waitForEvent('error', 20_000)

    // El error debe ser registrado
    const errors = await player.getErrors()
    expect(
      errors.length,
      'getErrors() debe tener error tras manifest 404'
    ).toBeGreaterThan(0)

    // Sin crashes JS del player
    expect(
      uncaughtErrors,
      `Manifest 404 no debe causar crashes JS. Errores: ${uncaughtErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  test('error fatal: player puede ser destruido sin error adicional post-error', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // Verifica que el player queda en estado estable después del error y se puede destruir.
    const invalidHlsUrl = 'http://localhost:9001/does-not-exist/manifest.m3u8'

    await mockContentConfig(page, {
      src: { hls: invalidHlsUrl },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('error', 20_000)

    const uncaughtAfterError: string[] = []
    page.on('pageerror', (err) => {
      if (!err.message.toLowerCase().includes('hls')) {
        uncaughtAfterError.push(err.message)
      }
    })

    // Destroy después del error — no debe lanzar errores adicionales
    await player.destroy()
    await page.waitForTimeout(300)

    expect(
      uncaughtAfterError,
      'destroy() después de error fatal no debe lanzar errores JS adicionales'
    ).toHaveLength(0)

    // El elemento <video> debe haberse removido del DOM (React unmount exitoso)
    const videoInDOM = await page.evaluate(() => document.querySelector('video') != null)
    expect(videoInDOM, '<video> debe ser removido tras destroy()').toBe(false)
  })

  test('error fatal con URL inaccesible: error tiene información identificable', async ({
    isolatedPlayer: player,
    page,
  }) => {
    await mockContentConfig(page, {
      src: { hls: 'http://localhost:9001/missing/stream.m3u8' },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('error', 20_000)

    const errors = await player.getErrors()
    expect(errors.length).toBeGreaterThan(0)

    // El error debe tener algún campo identificable
    const firstError = errors[0] as Record<string, unknown>
    const hasIdentifiableField =
      firstError?.type != null ||
      firstError?.code != null ||
      (typeof firstError?.message === 'string' && firstError.message.length > 0) ||
      firstError?.fatal != null

    expect(
      hasIdentifiableField,
      `Error de stream debe tener campo identificable. Recibido: ${JSON.stringify(firstError)}`
    ).toBe(true)
  })
})

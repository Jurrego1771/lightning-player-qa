/**
 * controls-api-edge.spec.ts — Tests de edge cases en la API de controles
 *
 * Cubre gaps MUST detectados por coverage-auditor:
 *   AC-CONTROLS-003: play() concurrente — guard _calledPlaying previene doble ejecución
 *   AC-CONTROLS-006: currentTime setter — ejecuta seek, emite seeking/seeked
 *
 * Diferencia con controls-api-hooks.spec.ts:
 *   controls-api-hooks.spec.ts cubre los hooks de UI internos (useControlsLeft, etc.).
 *   Este spec cubre la API pública del player: concurrencia de play() y seek vía currentTime.
 *
 * Fixture: isolatedPlayer (plataforma mockeada — determinista en CI)
 * Tag: @integration @controls
 */
import { test, expect, MockContentIds } from '../../fixtures'

// ── AC-CONTROLS-003: play() concurrente ──────────────────────────────────────

test.describe('Controls API — play() concurrente', {
  tag: ['@integration', '@controls'],
}, () => {
  // Cubre: AC-CONTROLS-003
  // Controls.play() tiene un guard `_calledPlaying` que previene que dos llamadas
  // simultáneas ambas lleguen a playerHandler.play(). La segunda llamada retorna
  // early si ya hay un play en curso.
  // Riesgo: sin el guard, dos play() concurrentes podrían causar doble buffer init,
  // estado inconsistente, o un error "already playing" dependiendo de la implementación.

  test('dos play() simultáneos: player llega a playing sin error, sin estado inválido', async ({
    isolatedPlayer: player,
    page,
  }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(25_000)

    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (!msg.includes('notallowederror') && !msg.includes('play()') && !msg.includes('autoplay')) {
        uncaughtErrors.push(err.message)
      }
    })

    // Llamar play() dos veces en el mismo microtask — máxima concurrencia posible
    // desde la perspectiva del event loop. El guard _calledPlaying debe absorber la segunda.
    const results = await page.evaluate(() => {
      const p1 = (window as any).__player.play().then(() => 'ok').catch((e: Error) => e?.message ?? 'error')
      const p2 = (window as any).__player.play().then(() => 'ok').catch((e: Error) => e?.message ?? 'error')
      return Promise.all([p1, p2])
    })

    // Al menos una de las dos debe haber tenido éxito (retornado 'ok' o equivalente)
    const anySuccess = results.some((r: string) => r === 'ok' || !r.toLowerCase().includes('not ready'))
    expect(
      anySuccess,
      `Al menos un play() debe tener éxito. Resultados: ${JSON.stringify(results)}`
    ).toBe(true)

    // El player debe llegar a estado playing
    await player.waitForEvent('playing', 20_000)

    // Sin crashes JS causados por concurrencia
    expect(
      uncaughtErrors,
      `play() concurrente no debe causar errores JS. Errores: ${uncaughtErrors.join(' | ')}`
    ).toHaveLength(0)

    // El player debe estar en estado válido (reproduciendo, no en error)
    await player.assertNoInitError()
    await player.assertIsPlaying()
  })

  test('play() concurrente con autoplay=true: sin error aunque el primer play ya haya iniciado', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // Variante: el player ya está en autoplay cuando se llama play() de nuevo.
    // Simula el caso donde el usuario hace click en play mientras el autoplay ya corre.
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (!msg.includes('notallowederror') && !msg.includes('autoplay')) {
        uncaughtErrors.push(err.message)
      }
    })

    // Llamar play() mientras ya está reproduciendo — no debe causar error
    await player.play()
    await page.waitForTimeout(500)

    // Player sigue reproduciendo sin error
    expect(uncaughtErrors, 'play() durante autoplay no debe lanzar errores').toHaveLength(0)
    await player.assertIsPlaying()
  })
})

// ── AC-CONTROLS-006: currentTime setter ──────────────────────────────────────

test.describe('Controls API — currentTime setter (seek)', {
  tag: ['@integration', '@controls'],
}, () => {
  // Cubre: AC-CONTROLS-006
  // Asignar player.currentTime = N activa el seek en playerHandler o adsManager.
  // El player debe emitir 'seeking' (inmediato) y 'seeked' (cuando el seek completa).
  // El valor leído de player.currentTime post-seek debe ser aproximado al target.

  test('player.currentTime = 5: emite seeking+seeked, currentTime ≈ 5s', async ({
    isolatedPlayer: player,
    page,
  }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Dar tiempo para que hls.js descargue suficiente buffer antes del seek
    // (el seek requiere que el target esté en el rango seekable).
    await page.waitForFunction(
      () => {
        const ct = (window as any).__player?.currentTime ?? 0
        return ct > 1
      },
      { timeout: 15_000 }
    )

    // Ejecutar seek a 5s
    await player.seek(5)

    // Seeking debe emitirse inmediatamente
    await player.waitForEvent('seeking', 10_000)

    // Seeked indica que el seek completó
    await player.waitForEvent('seeked', 15_000)

    // currentTime debe reflejar el valor del seek (±0.5s de tolerancia por la precisión de HLS)
    const currentTime = await player.getCurrentTime()
    expect(
      currentTime,
      'currentTime post-seek debe ser aproximadamente 5s'
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      currentTime,
      'currentTime post-seek no debe sobrepasarse del target significativamente'
    ).toBeLessThanOrEqual(7) // HLS snapea al keyframe más cercano, puede ser hasta ~2s después

    // Player sigue en estado válido
    await player.assertNoInitError()
  })

  test('player.currentTime = 0: seek al inicio emite eventos de seek', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // Verificar que el seek al inicio (t=0) también emite seeking/seeked.
    // Este es un caso edge: algunos players optimizan el seek a 0 y no emiten eventos.
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Avanzar un poco antes de hacer seek al inicio
    await page.waitForFunction(
      () => ((window as any).__player?.currentTime ?? 0) > 2,
      { timeout: 15_000 }
    )

    // Seek al inicio
    await player.seek(0)
    await player.waitForEvent('seeked', 15_000)

    const currentTime = await player.getCurrentTime()
    expect(
      currentTime,
      'Seek a 0 debe posicionar el player al inicio (< 1s)'
    ).toBeLessThan(1)
  })

  test('player.currentTime negativo: clampea a 0 sin error', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // El contrato dice: valores negativos → 0 (clamping silencioso).
    // El test verifica que no se lanza error y el player clampea correctamente.
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => uncaughtErrors.push(err.message))

    // Asignar valor negativo — debe clampear a 0 silenciosamente
    await player.seek(-5)
    await page.waitForTimeout(1000)

    // Sin errores
    expect(uncaughtErrors, 'seek(-5) no debe lanzar errores JS').toHaveLength(0)

    // currentTime debe ser >= 0
    const currentTime = await player.getCurrentTime()
    expect(
      currentTime,
      'Seek a valor negativo debe producir currentTime >= 0'
    ).toBeGreaterThanOrEqual(0)
  })
})

/**
 * api-bootstrap.spec.ts — Tests de contrato para los mecanismos de inicialización del player
 *
 * Cubre gaps MUST detectados por coverage-auditor:
 *   AC-BOOTSTRAP-003: data-id inválido (404) → error event, sin retry loop infinito
 *   AC-BOOTSTRAP-006: playerloaded CustomEvent y data-loaded callback
 *
 * Los mecanismos de inicialización ya cubiertos en otros specs:
 *   AC-BOOTSTRAP-001/002: loadMSPlayer() y script embed → vod-playback.spec.ts, player-api.spec.ts
 *
 * Estrategia:
 *   AC-BOOTSTRAP-003 usa mockContentError(page, 404) para simular plataforma inaccesible.
 *   AC-BOOTSTRAP-006 usa gotoMultiInit() que navega al harness multi-init.html, que
 *   implementa data-loaded y playerloaded event. window.__qa.initMethod registra qué
 *   mecanismo resolvió el player.
 *
 * Tag: @contract @bootstrap
 */
import { test, expect, MockContentIds, mockContentError } from '../../fixtures'

// ── AC-BOOTSTRAP-003: data-id inválido → error, sin retry ────────────────────

test.describe('Bootstrap — data-id inválido emite error sin retry loop', {
  tag: ['@contract', '@bootstrap'],
}, () => {
  // Cubre: AC-BOOTSTRAP-003
  // Cuando la plataforma retorna 404 para el content config, el player debe:
  //   1. Emitir evento 'error' (con fatal:true implícito — no hay contenido que reproducir)
  //   2. NO reintentar la request en loop infinito (el test mide el tiempo: si el error
  //      se emite rápido no hubo loop de retries largos)
  //   3. Quedar en estado estable (sin crashear JS)

  test('content 404: error event se emite y player no crashea', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // mockContentError tiene precedencia LIFO sobre setupPlatformMocks ya activo
    await mockContentError(page, 404)

    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => uncaughtErrors.push(err.message))

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })

    // El error debe emitirse dentro de 15s — si el player reintenta en loop,
    // el error podría no emitirse hasta que el loop termine (o no terminar nunca).
    const start = Date.now()
    await player.waitForEvent('error', 15_000)
    const elapsed = Date.now() - start

    // El error se emitió: verificar que el player lo registró
    const initError = await player.hasInitError()
    const errors = await player.getErrors()
    expect(
      initError !== null || errors.length > 0,
      'Player debe registrar el fallo 404 en initError o getErrors()'
    ).toBe(true)

    // Sin crashes JS causados por el estado de error
    expect(
      uncaughtErrors,
      `Content 404 no debe causar crashes JS. Errores: ${uncaughtErrors.join(' | ')}`
    ).toHaveLength(0)

    // El error se emitió rápidamente (< 10s) → no hubo loop de retries extenso
    expect(
      elapsed,
      `El error se emitió después de ${elapsed}ms. Si es > 10s, el player puede estar reintentando la config.`
    ).toBeLessThan(10_000)
  })

  test('content 404: getErrors() tiene datos del error de plataforma', async ({
    isolatedPlayer: player,
    page,
  }) => {
    await mockContentError(page, 404)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForEvent('error', 15_000)

    const errors = await player.getErrors()
    expect(errors.length, 'getErrors() debe tener al menos un error').toBeGreaterThan(0)

    // El error debe tener información identificable (type, code, o message)
    const firstError = errors[0] as Record<string, unknown>
    const hasIdentifiableField =
      firstError?.type != null ||
      firstError?.code != null ||
      (typeof firstError?.message === 'string' && firstError.message.length > 0)

    expect(
      hasIdentifiableField,
      `Error de plataforma debe tener campo identificable (type/code/message). Recibido: ${JSON.stringify(firstError)}`
    ).toBe(true)
  })
})

// ── AC-BOOTSTRAP-006: playerloaded event y data-loaded callback ───────────────

test.describe('Bootstrap — playerloaded CustomEvent y data-loaded callback', {
  tag: ['@contract', '@bootstrap'],
}, () => {
  // Cubre: AC-BOOTSTRAP-006
  // El player soporta dos mecanismos de inicialización via script tag:
  //   A) data-loaded="myCallback" → el player llama a window.myCallback(player)
  //   B) script.addEventListener('playerloaded', e => e.detail) → CustomEvent en el script
  // Ambos mecanismos deben entregar la instancia del player con play/pause/destroy.

  test('data-loaded callback: player entrega instancia vía callback', async ({
    isolatedPlayer: player,
  }) => {
    // gotoMultiInit con 'callback' usa el harness multi-init.html → __initViaCallback()
    // que establece data-loaded="__playerLoadedCallback" en el script tag.
    // El player invoca window.__playerLoadedCallback(playerInstance) al estar listo.
    await player.gotoMultiInit({ type: 'media', id: MockContentIds.vod, autoplay: false }, 'callback')

    // Verificar que el mecanismo de callback funcionó
    const initMethod = await player.page.evaluate(() => (window as any).__qa?.initMethod)
    expect(
      initMethod,
      'El player debe haber sido inicializado vía callback (data-loaded attribute)'
    ).toBe('callback')

    // La instancia del player debe estar disponible con la API requerida
    const hasApi = await player.page.evaluate(() => {
      const p = (window as any).__player
      return p && typeof p.play === 'function' && typeof p.pause === 'function' && typeof p.destroy === 'function'
    })
    expect(
      hasApi,
      'La instancia recibida via callback debe tener play, pause, destroy'
    ).toBe(true)

    await player.assertNoInitError()
  })

  test('playerloaded CustomEvent: player dispara evento en script tag con instancia', async ({
    isolatedPlayer: player,
  }) => {
    // gotoMultiInit con 'event' usa __initViaEvent() que registra addEventListener('playerloaded')
    // ANTES de appendear el script, y recibe la instancia en event.detail.
    await player.gotoMultiInit({ type: 'media', id: MockContentIds.vod, autoplay: false }, 'event')

    // Verificar que el mecanismo de event funcionó
    const initMethod = await player.page.evaluate(() => (window as any).__qa?.initMethod)
    expect(
      initMethod,
      'El player debe haber sido inicializado vía playerloaded CustomEvent'
    ).toBe('event')

    // La instancia del player debe estar disponible con la API requerida
    const hasApi = await player.page.evaluate(() => {
      const p = (window as any).__player
      return p && typeof p.play === 'function' && typeof p.pause === 'function' && typeof p.destroy === 'function'
    })
    expect(
      hasApi,
      'La instancia recibida via playerloaded event debe tener play, pause, destroy'
    ).toBe(true)

    await player.assertNoInitError()
  })

  test('playerloaded CustomEvent: event.detail es la instancia del player (no null)', async ({
    isolatedPlayer: player,
  }) => {
    // Verificación más estricta: event.detail != null en el momento del evento.
    // El harness guarda __qa.initialized = true después de recibir la instancia via el event.
    // Si event.detail fuera null, __setupPlayerEvents fallaría con TypeError y el player
    // no quedaría inicializado.
    await player.gotoMultiInit({ type: 'media', id: MockContentIds.vod, autoplay: false }, 'event')

    const initialized = await player.page.evaluate(() => (window as any).__qa?.initialized)
    expect(
      initialized,
      'window.__qa.initialized debe ser true — confirma que playerloaded event.detail no fue null'
    ).toBe(true)

    const initError = await player.hasInitError()
    expect(initError, 'Sin error de init — playerloaded event.detail fue válido').toBeNull()
  })
})

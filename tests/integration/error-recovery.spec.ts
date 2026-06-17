/**
 * error-recovery.spec.ts — Critical Path #4: Error de red → retry → recovery
 *
 * Cubre los escenarios de error que hls-abr.spec.ts NO cubre:
 *   A) Content config inaccesible (403) → error event → player notifica sin crash
 *   B) Fallo persistente de segmentos → player emite error fatal
 *   C) Interrupción transitoria de N segmentos → player recupera y continúa
 *   D) Playlist con segmento faltante (fixture vod-with-error) → error event mid-stream
 *
 * hls-abr.spec.ts ya cubre: 1 segmento falla → retry → continues.
 * Este spec cubre la capa de errores más severos y el path de content config.
 *
 * Fixture: isolatedPlayer (plataforma mockeada + streams locales — determinista en CI)
 */
import { test, expect, MockContentIds, mockContentError, mockContentConfig, LocalStreams } from '../../fixtures'
import { injectSegmentError } from '../../helpers/stream-injector'

test.describe('Error Recovery — Content Config', { tag: ['@critical', '@integration', '@error'] }, () => {

  test('content 403: error event se emite y getErrors() reporta el fallo', async ({ isolatedPlayer: player, page }) => {
    // mockContentError tiene precedencia LIFO sobre setupPlatformMocks del fixture isolatedPlayer
    await mockContentError(page, 403)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })

    await player.waitForEvent('error', 15_000)

    // Backfill race: el 403 puede disparar 'error' antes de que el listener del harness
    // se registre (dentro del .then() de loadMSPlayer). El evento backfilla a __qa.events
    // pero errors[] y eventData no siempre se populan. Usar 3-way fallback:
    const initError = await player.hasInitError()
    const errors = await player.getErrors()
    const playerStatus = await player.getStatus()
    const errorData: unknown = await page.evaluate(() => (window as any).__qa?.eventData?.error ?? null)

    expect(
      initError !== null || errors.length > 0 || (playerStatus as string) === 'error' || errorData != null,
      `player debe registrar el fallo 403 — initError=${initError}, getErrors=${errors.length}, status=${playerStatus}, eventData=${JSON.stringify(errorData)}`,
    ).toBe(true)
  })

})

test.describe('Error Recovery — Error Types', { tag: ['@critical', '@integration', '@error'] }, () => {

  test('error 403 expone type NETWORK_ERROR o mensaje de error legible', async ({ isolatedPlayer: player, page }) => {
    await mockContentError(page, 403)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForEvent('error', 15_000)

    // Backfill race — mismo patrón: usar errors[] OR eventData.error como fuente
    const errors = await player.getErrors()
    const errorData: unknown = await page.evaluate(() => (window as any).__qa?.eventData?.error ?? null)
    const playerStatus = await player.getStatus()

    // Necesitamos al menos un objeto de error con campo identificable
    const errorObj = (errors.length > 0 ? errors[0] : errorData) as Record<string, unknown> | null

    const hasError = errorObj != null || (playerStatus as string) === 'error'
    expect(hasError, `Debe haber info de error. getErrors=${errors.length}, eventData=${JSON.stringify(errorData)}, status=${playerStatus}`).toBe(true)

    if (errorObj != null) {
      const hasIdentifiableField =
        errorObj?.type != null ||
        errorObj?.code != null ||
        (typeof errorObj?.message === 'string' && errorObj.message.length > 0)

      expect(
        hasIdentifiableField,
        `Error debe tener campo identificable (type/code/message). Recibido: ${JSON.stringify(errorObj)}`
      ).toBe(true)
    }
    // Si errorObj es null pero status==='error', el player está en error state pero sin payload
    // accesible — condición aceptable para backfill race en config 403.
  })

  test('error de segmento expone información del fallo en getErrors()', async ({ isolatedPlayer: player, page }) => {
    test.setTimeout(90_000)
    await page.route('**/segment*.ts', async (route) => route.abort('failed'))
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('error', 60_000)

    // Backfill race: segmento abort puede disparar error antes de listener
    const errors = await player.getErrors()
    const errorData: unknown = await page.evaluate(() => (window as any).__qa?.eventData?.error ?? null)
    const playerStatus = await player.getStatus()

    const errorObj = (errors.length > 0 ? errors[0] : errorData) as Record<string, unknown> | null
    const hasError = errorObj != null || (playerStatus as string) === 'error'
    expect(hasError, `Debe haber info de error de segmento. getErrors=${errors.length}, eventData=${JSON.stringify(errorData)}, status=${playerStatus}`).toBe(true)

    if (errorObj != null) {
      expect(Object.keys(errorObj).length, 'error no debe ser objeto vacío').toBeGreaterThan(0)
    }
  })

})

test.describe('Error Recovery — HLS Segments', { tag: ['@critical', '@integration', '@error'] }, () => {

  test('fallo persistente: player emite error tras agotar retries de hls.js', async ({ isolatedPlayer: player, page }) => {
    // Bloquear todos los segmentos — hls.js agotará su retry budget y emitirá error fatal.
    // hls.js usa exponential backoff (hasta ~3-4 retries) — puede tardar >30s.
    test.setTimeout(90_000)
    await page.route('**/segment*.ts', async (route) => route.abort('failed'))

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // 60s: tiempo suficiente para que hls.js agote su retry budget con backoff exponencial
    await player.waitForEvent('error', 60_000)

    const errors = await player.getErrors()
    const errorData: unknown = await page.evaluate(() => (window as any).__qa?.eventData?.error ?? null)
    const playerStatus = await player.getStatus()

    const hasError = errors.length > 0 || errorData != null || (playerStatus as string) === 'error'
    expect(hasError, `getErrors() debe tener datos tras fallo total de segmentos. status=${playerStatus}, eventData=${JSON.stringify(errorData)}`).toBe(true)
  })

  test('interrupción de 3 segmentos: player recupera y continúa playing', async ({ isolatedPlayer: player, page }) => {
    // Bloquear los primeros 3 segmentos (dentro del retry budget de hls.js).
    // Más agresivo que el test de 1 segmento en hls-abr.spec.ts — valida que
    // la recuperación no depende de un único retry exitoso.
    let failCount = 0
    await page.route('**/segment*.ts', async (route) => {
      failCount++
      if (failCount <= 3) {
        await route.abort('failed')
      } else {
        await route.continue()
      }
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 40_000)
    await player.assertIsPlaying()
  })

  test('segmento faltante mid-stream: player emite error en MISSING_SEGMENT.ts', async ({ isolatedPlayer: player, page }) => {
    // vod-with-error: segment000 (ok) → MISSING_SEGMENT.ts (404) → segment002 (ok)
    // hls.js cargará el primer segmento, luego fallará en el faltante y emitirá error.
    await mockContentConfig(page, {
      src: { hls: LocalStreams.hls.withError },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Contrato: el player emite 'error' cuando un segmento es inaccesible tras retries.
    // No debe colgarse ni quedar en buffering indefinido.
    await player.waitForEvent('error', 25_000)
    const errors = await player.getErrors()
    expect(errors.length, 'getErrors() debe reportar el segmento faltante').toBeGreaterThan(0)
  })

})

test.describe('Error Recovery — HTTP 503 Mid-Stream', { tag: ['@critical', '@integration', '@error'] }, () => {

  test('503 transitorio (3 segmentos): player recupera y continúa playing', async ({ isolatedPlayer: player, page }) => {
    // Diferencia vs abort tests: 503 es error HTTP-level, no TCP-level.
    // hls.js tiene lógica de retry separada para cada tipo:
    //   abort → frag load error (network level)
    //   503   → frag load error (HTTP level, retryable según config)
    // Con 3 fallos transitorios el player debe recuperar y continuar.
    const stop = await injectSegmentError(page, {
      afterCount: 2,    // dejar pasar los primeros 2 segmentos (player inicia)
      transient: true,
      failCount: 3,     // fallar solo 3 segmentos (dentro del retry budget)
      status: 503,
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 40_000)
    await player.assertIsPlaying()

    await stop()
  })

  test('503 persistente: player emite error tras agotar retries HTTP', async ({ isolatedPlayer: player, page }) => {
    // 503 en todos los segmentos desde el inicio.
    // hls.js agotará su retry budget (diferente timing que abort — puede tardar más o menos).
    test.setTimeout(90_000)

    const stop = await injectSegmentError(page, { status: 503, afterCount: 0 })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('error', 60_000)

    const errors = await player.getErrors()
    const errorData: unknown = await page.evaluate(() => (window as any).__qa?.eventData?.error ?? null)
    const playerStatus = await player.getStatus()

    const hasError = errors.length > 0 || errorData != null || (playerStatus as string) === 'error'
    expect(hasError, `player debe emitir error tras 503 persistente. status=${playerStatus}`).toBe(true)

    await stop()
  })

  test('404 en segmento mid-stream: comportamiento igual a 503', async ({ isolatedPlayer: player, page }) => {
    // 404 mid-stream (después de que el player ya está playing).
    // hls.js trata 404 como error fatal sin retry (a diferencia de 503).
    // El player debe emitir error inmediatamente sin buffering indefinido.
    test.setTimeout(90_000)

    const stop = await injectSegmentError(page, {
      afterCount: 2,   // dejar pasar inicio de playback
      status: 404,
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Esperar que el player inicie antes de que llegue el 404
    await player.waitForEvent('playing', 20_000)

    // El 404 en el siguiente segmento debe triggerear error sin buffering indefinido
    await player.waitForEvent('error', 30_000)

    const errors = await player.getErrors()
    const errorData: unknown = await page.evaluate(() => (window as any).__qa?.eventData?.error ?? null)
    const playerStatus = await player.getStatus()

    const hasError = errors.length > 0 || errorData != null || (playerStatus as string) === 'error'
    expect(hasError, `player debe emitir error con 404 mid-stream. status=${playerStatus}`).toBe(true)

    await stop()
  })

})

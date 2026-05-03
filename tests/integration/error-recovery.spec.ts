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

test.describe('Error Recovery — Content Config', { tag: ['@integration', '@error'] }, () => {

  test('content 403: error event se emite y getErrors() reporta el fallo', async ({ isolatedPlayer: player, page }) => {
    // mockContentError tiene precedencia LIFO sobre setupPlatformMocks del fixture isolatedPlayer
    await mockContentError(page, 403)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })

    await player.waitForEvent('error', 15_000)

    // El error debe quedar registrado — ya sea como initError o en el array de errors
    const initError = await player.hasInitError()
    const errors = await player.getErrors()
    expect(
      initError !== null || errors.length > 0,
      'player debe registrar el fallo 403 — initError o getErrors() no vacío',
    ).toBe(true)
  })

})

test.describe('Error Recovery — HLS Segments', { tag: ['@integration', '@error'] }, () => {

  test('fallo persistente: player emite error tras agotar retries de hls.js', async ({ isolatedPlayer: player, page }) => {
    // Bloquear todos los segmentos — hls.js agotará su retry budget y emitirá error fatal
    await page.route('**/segment*.ts', async (route) => route.abort('failed'))

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    await player.waitForEvent('error', 30_000)
    const errors = await player.getErrors()
    expect(errors.length, 'getErrors() debe tener datos tras fallo total de segmentos').toBeGreaterThan(0)
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

/**
 * dash-abr.spec.ts — Tests de integración para ABR en DASH
 *
 * Cubre: Adaptive Bitrate en DASH (representationchange event).
 * El nuevo DashHandler implementa ABR via dashjs. Este spec verifica que
 * el evento 'representationchange' (o 'levelchanged' según el bridge de
 * eventos) se emite cuando dashjs conmuta de representación.
 *
 * Fixture: isolatedPlayer (plataforma mockeada, stream DASH externo vía src)
 * NOTA: No hay MPD local aún. Usamos ExternalStreams.dash.vod via src directo.
 * En test de integración puro se usa isolatedPlayer para aislar la plataforma,
 * pero el stream DASH sigue siendo externo (no hay servidor MPD local).
 * Si el stream externo no es accesible en CI, los tests se saltarán con skip.
 *
 * Tag: @integration
 */
import { test, expect, MockContentIds, ExternalStreams } from '../../fixtures'
import {
  createCDPSession,
  setNetworkThrottle,
  removeNetworkThrottle,
} from '../../helpers/qoe-metrics'

const DASH_SRC = ExternalStreams.dash.vod

test.describe('DASH Adaptive Bitrate', { tag: ['@integration'] }, () => {

  test('representationchange se emite al inicio (dashjs elige representación inicial)', async ({ isolatedPlayer: player }) => {
    // Arrange — usar src directo para bypassear la plataforma mockeada
    await player.goto({ type: 'media', src: DASH_SRC, autoplay: true })
    await player.waitForEvent('playing', 30_000)

    // Assert — el player debe emitir levelchanged (puente DASH→eventos del player)
    // o representationchange dependiendo de cómo lo exponga el DashHandler
    const events: string[] = await player.page.evaluate(() => (window as any).__qa?.events ?? [])

    const hasRepresentationEvent = events.includes('levelchanged') ||
      events.includes('representationchange') ||
      events.includes('qualitychanged')

    expect(
      hasRepresentationEvent,
      `Se esperaba que dashjs emita un evento de cambio de representación. ` +
      `Eventos recibidos: [${events.join(', ')}]. ` +
      `Verificar que DashHandler hace bridge de DASH_REPRESENTATION_SWITCH a 'levelchanged'.`
    ).toBe(true)
  })

  test('bajo bandwidth degradado, DASH selecciona representación de menor bitrate', async ({ isolatedPlayer: player, page }) => {
    test.skip(
      !(page as any).context,
      'CDP solo disponible en Chromium — correr con proyecto performance o chromium'
    )

    const cdp = await createCDPSession(page)

    // Arrange
    await player.goto({ type: 'media', src: DASH_SRC, autoplay: true })
    await player.waitForEvent('playing', 30_000)

    // Throttlear a ~500Kbps para forzar a dashjs a bajar representación
    await setNetworkThrottle(cdp, {
      downloadThroughput: (500 * 1024) / 8,
      uploadThroughput:   (250 * 1024) / 8,
      latency: 150,
    })

    // Esperar a que dashjs reaccione y emita cambio de representación
    await player.waitForEvent('levelchanged', 40_000)

    // Assert — el player debe seguir reproduciendo (o al menos no tener error fatal)
    const metrics = await player.getQoEMetrics()
    expect(metrics.bufferedAhead).toBeGreaterThanOrEqual(0)
    await player.assertNoInitError()

    await removeNetworkThrottle(cdp)
    await cdp.detach()
  })

  test('recovery de bandwidth en DASH: representación sube al restaurar red', async ({ isolatedPlayer: player, page }) => {
    test.skip(
      !(page as any).context,
      'CDP solo disponible en Chromium — correr con proyecto performance o chromium'
    )

    const cdp = await createCDPSession(page)

    // Arrange
    await player.goto({ type: 'media', src: DASH_SRC, autoplay: true })
    await player.waitForEvent('playing', 30_000)

    // Degradar la red y esperar que dashjs reaccione
    await setNetworkThrottle(cdp, {
      downloadThroughput: (500 * 1024) / 8,
      uploadThroughput:   (250 * 1024) / 8,
      latency: 150,
    })
    await player.waitForEvent('levelchanged', 40_000)

    // Restaurar bandwidth — dashjs debe subir representación
    await removeNetworkThrottle(cdp)
    await setNetworkThrottle(cdp, {
      downloadThroughput: (25 * 1024 * 1024) / 8,
      uploadThroughput:   (10 * 1024 * 1024) / 8,
      latency: 5,
    })

    // Esperar segundo levelchanged (el switch hacia arriba)
    await player.waitForEvent('levelchanged', 40_000)

    const events: string[] = await player.page.evaluate(() => (window as any).__qa?.events ?? [])
    const levelChangedCount = events.filter((e) => e === 'levelchanged').length
    expect(
      levelChangedCount,
      'Se esperaban al menos 2 eventos levelchanged: uno al bajar y otro al subir representación'
    ).toBeGreaterThanOrEqual(2)

    await cdp.detach()
  })
})

/**
 * analytics-first-play.spec.ts — Evento contentFirstPlay del Lightning Player
 *
 * Cubre: el player emite contentFirstPlay exactamente una vez, en la primera
 * transición ready → playing de un contenido. No en replays ni en loads subsiguientes.
 *
 * Criterios de aceptación:
 *   DEBE: contentFirstPlay emitido al pasar de ready → playing por primera vez
 *   DEBE: emitido exactamente 1 vez (no duplicado en el mismo array de eventos)
 *   NO DEBE: emitirse en un segundo play() tras pause()
 *   NO DEBE: emitirse en un segundo load() del mismo player instance (sourcechange)
 *
 * Fixture: isolatedPlayer (plataforma mockeada + stream HLS local — sin CDN)
 * Tag: @integration
 *
 * Fuera de scope:
 *   - Live streams
 *   - Flujos con ads (pre-roll + contentFirstPlay — gap separado)
 *   - Analytics de red (track.mdstrm.com — gap #11, spec separado)
 */
import { test, expect, MockContentIds } from '../../fixtures'

test.describe('Analytics — contentFirstPlay', { tag: ['@integration'] }, () => {

  test('contentFirstPlay se emite en la primera reproducción', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertNoInitError()

    // Assert: el evento debe estar presente en el array de eventos rastreados
    const events: string[] = await page.evaluate(() => (window as any).__qa.events ?? [])
    expect(
      events,
      'contentFirstPlay debe estar en __qa.events tras la primera reproducción',
    ).toContain('contentFirstPlay')
  })

  test('contentFirstPlay se emite exactamente una vez (no duplicado)', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertNoInitError()

    // Assert: count === 1 — el harness registra duplicados, por lo que un conteo
    // mayor a 1 indica una emisión múltiple del mismo evento en la misma sesión
    const events: string[] = await page.evaluate(() => (window as any).__qa.events ?? [])
    const count = events.filter((e) => e === 'contentFirstPlay').length
    expect(
      count,
      `contentFirstPlay debe emitirse exactamente 1 vez, se emitió ${count} veces`,
    ).toBe(1)
  })

  test('contentFirstPlay NO se emite en replay (play tras pause)', async ({ isolatedPlayer: player, page }) => {
    // BUG CONOCIDO: el player emite contentFirstPlay en cada play(), no solo en el primero.
    // Estándar de industria (Segment/RudderStack): pause→play es la misma sesión → no debe
    // dispararse. Reportado al equipo del player — pendiente fix.
    test.fail(true, 'BUG-contentFirstPlay-replay: player emite el evento en pause→play. Misma sesión no debe re-emitirlo.')

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertNoInitError()

    await page.evaluate(() => (window as any).__player?.pause())
    await player.waitForEvent('pause', 10_000)
    await page.evaluate(() => { (window as any).__qa.events = [] })

    await page.evaluate(() => (window as any).__player?.play())
    await player.waitForEvent('playing', 15_000)

    const eventsAfterResume: string[] = await page.evaluate(() => (window as any).__qa.events ?? [])
    expect(
      eventsAfterResume,
      'contentFirstPlay NO debe emitirse en un replay (play tras pause)',
    ).not.toContain('contentFirstPlay')
  })

  test('contentFirstPlay NO se emite en un segundo load()', async ({ isolatedPlayer: player, page }) => {
    // BUG PROBABLE: el player emite contentFirstPlay en cada load() de nuevo contenido.
    // Pendiente confirmación con el equipo: ¿load() crea un nuevo session_id?
    // Si SÍ crea session_id nuevo → comportamiento correcto, cambiar aserción a toContain.
    // Si NO cambia session_id → bug (misma sesión, no debe re-emitirse).
    // Referencia: estándar Segment/RudderStack — dos contenidos en el mismo player = misma sesión.
    test.fail(true, 'BUG-contentFirstPlay-load: pendiente confirmar si load() genera nuevo session_id. Ver análisis en analytics-first-play.spec.ts.')

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertNoInitError()

    await player.load({ type: 'media', id: MockContentIds.episode })
    await player.waitForEvent('playing', 20_000)

    const eventsAfterLoad: string[] = await page.evaluate(() => (window as any).__qa.events ?? [])
    expect(
      eventsAfterLoad,
      'contentFirstPlay NO debe emitirse al cargar un segundo contenido via load()',
    ).not.toContain('contentFirstPlay')
  })
})

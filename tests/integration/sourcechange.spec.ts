/**
 * sourcechange.spec.ts — Evento sourcechange en cambio de contenido via load()
 *
 * Gap #14: verifica que sourcechange se emita correctamente cuando load() cambia el src.
 *
 * Comportamiento del player (src/player/base.js:327-328):
 *   sourcechange se emite cuando props.src !== state.src.
 *   load() con el mismo type+id es idempotente (player.jsx:329) — no dispara sourcechange.
 *
 * Criterios de aceptación:
 *   DEBE: emitirse cuando load() carga contenido con src diferente
 *   DEBE: payload del evento ser la nueva URL de src
 *   DEBE: emitirse antes del evento 'playing' del nuevo contenido
 *   DEBE: emitirse exactamente una vez por load() con src diferente
 *   NO DEBE: emitirse cuando load() se llama con el mismo type+id (idempotencia)
 *
 * Fixture: isolatedPlayer
 *   vod.json  → src.hls = localhost:9001/vod/master.m3u8
 *   audio.json → src.hls = localhost:9001/audio/index.m3u8  (URLs distintas)
 *
 * Tag: @integration
 *
 * Fuera de scope:
 *   - sourcechange en el init inicial (se backfilla — cubierto por harness)
 *   - sourcechange con DRM o ads activos
 */
import { test, expect, MockContentIds } from '../../fixtures'

test.describe('sourcechange — cambio de contenido via load()', { tag: ['@integration'] }, () => {

  test('sourcechange se emite al cargar contenido con src diferente', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertNoInitError()

    // load() resetea __qa.events internamente antes de llamar a player.load()
    await player.load({ type: 'media', id: MockContentIds.audio })

    await expect.poll(
      () => page.evaluate(() => (window as any).__qa.events ?? []),
      { timeout: 15_000, message: 'sourcechange debe estar en __qa.events tras load() con src diferente' },
    ).toContain('sourcechange')
  })

  test('payload de sourcechange es la nueva URL del stream', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForEvent('ready', 20_000)

    // Registrar el payload antes de load() para capturarlo limpio
    await page.evaluate(() => {
      ;(window as any).__qa.events = []
      ;(window as any).__qa.eventData = {}
      ;(window as any).__qa.ready = false
    })

    await page.evaluate((opts) => (window as any).__player?.load(opts), { type: 'media', id: MockContentIds.audio })

    await expect.poll(
      () => page.evaluate(() => (window as any).__qa.eventData?.['sourcechange']),
      { timeout: 15_000, message: 'sourcechange payload debe ser la URL del nuevo stream' },
    ).toMatch(/localhost:9001\/audio\/index\.m3u8/)
  })

  test('sourcechange se emite antes de playing en el nuevo contenido', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await player.load({ type: 'media', id: MockContentIds.audio })
    await player.waitForEvent('playing', 20_000)

    const events: string[] = await page.evaluate(() => (window as any).__qa.events ?? [])
    const sourcechangeIdx = events.indexOf('sourcechange')
    const playingIdx      = events.indexOf('playing')

    expect(sourcechangeIdx, 'sourcechange debe estar en __qa.events').toBeGreaterThanOrEqual(0)
    expect(playingIdx,      'playing debe estar en __qa.events').toBeGreaterThanOrEqual(0)
    expect(
      sourcechangeIdx,
      'sourcechange debe preceder a playing en el array de eventos',
    ).toBeLessThan(playingIdx)
  })

  test('sourcechange se emite exactamente una vez por load()', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await player.load({ type: 'media', id: MockContentIds.audio })
    await player.waitForEvent('playing', 20_000)

    const events: string[] = await page.evaluate(() => (window as any).__qa.events ?? [])
    const count = events.filter(e => e === 'sourcechange').length
    expect(
      count,
      `sourcechange debe emitirse exactamente 1 vez, se emitió ${count} veces`,
    ).toBe(1)
  })

  test('sourcechange NO se emite cuando load() recibe el mismo type+id', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Limpiar eventos y llamar load() directamente (sin el reset del fixture)
    // para capturar únicamente el resultado de la segunda llamada
    await page.evaluate(() => {
      ;(window as any).__qa.events = []
      ;(window as any).__qa.ready = false
    })

    // Segunda llamada con el mismo id — el player la descarta (uniqueKey match)
    await page.evaluate((opts) => (window as any).__player?.load(opts), { type: 'media', id: MockContentIds.vod })

    // Dar tiempo suficiente para que sourcechange apareciera si se emitiera
    await page.waitForTimeout(2_000)

    const events: string[] = await page.evaluate(() => (window as any).__qa.events ?? [])
    expect(
      events,
      'sourcechange NO debe emitirse cuando load() recibe el mismo type+id (idempotente)',
    ).not.toContain('sourcechange')
  })

})

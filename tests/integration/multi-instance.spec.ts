/**
 * multi-instance.spec.ts — Dos instancias del Lightning Player en la misma página
 *
 * Gap #6: verifica que dos instancias sean completamente independientes.
 *
 * Criterios de aceptación:
 *   DEBE: ambas instancias inicializar sin error
 *   DEBE: player1 !== player2 (refs distintas)
 *   DEBE: eventos de player2 no disparan listeners de player1 (y viceversa)
 *   DEBE: cambiar volume/currentTime en player1 no afecta player2
 *   DEBE: __qaMulti.players[0] y [1] trackean eventos independientemente
 *   DEBE: destroy(player1) no interrumpe player2
 *
 * Harness: multi-instance.html — dos containers, __qaMulti.players[0|1]
 * Fixture: isolatedPlayer (plataforma mockeada — page.route cubre ambas instancias)
 * Tag: @integration
 *
 * Fuera de scope:
 *   - Comportamiento de playback en sí (cubierto por otros specs)
 *   - Más de dos instancias simultáneas
 *   - Interacción de ads entre instancias
 */
import { test, expect, MockContentIds } from '../../fixtures'

test.describe('Multi-Instance — Aislamiento entre dos players', { tag: ['@integration'] }, () => {

  test('ambas instancias inicializan sin error', async ({ isolatedPlayer: player }) => {
    await player.gotoMultiInstance(
      { type: 'media', id: MockContentIds.vod, autoplay: false },
      { type: 'media', id: MockContentIds.vod, autoplay: false },
    )

    expect(await player.hasInitErrorForPlayer(0)).toBeNull()
    expect(await player.hasInitErrorForPlayer(1)).toBeNull()
  })

  test('player1 y player2 son instancias distintas con API completa', async ({ isolatedPlayer: player, page }) => {
    await player.gotoMultiInstance(
      { type: 'media', id: MockContentIds.vod, autoplay: false },
      { type: 'media', id: MockContentIds.vod, autoplay: false },
    )

    const result = await page.evaluate(() => {
      const p1 = (window as any).player1
      const p2 = (window as any).player2
      return {
        bothDefined:  !!p1 && !!p2,
        sameRef:      p1 === p2,
        p1HasPlay:    typeof p1?.play  === 'function',
        p2HasPlay:    typeof p2?.play  === 'function',
        p1HasPause:   typeof p1?.pause === 'function',
        p2HasPause:   typeof p2?.pause === 'function',
      }
    })

    expect(result.bothDefined).toBe(true)
    expect(result.sameRef, 'player1 y player2 deben ser instancias distintas').toBe(false)
    expect(result.p1HasPlay).toBe(true)
    expect(result.p2HasPlay).toBe(true)
    expect(result.p1HasPause).toBe(true)
    expect(result.p2HasPause).toBe(true)
  })

  test('volumechange de player2 no dispara listener de player1', async ({ isolatedPlayer: player, page }) => {
    await player.gotoMultiInstance(
      { type: 'media', id: MockContentIds.vod, autoplay: false },
      { type: 'media', id: MockContentIds.vod, autoplay: false },
    )

    // Registrar contadores independientes por instancia
    await page.evaluate(() => {
      ;(window as any).__testFired = { p1: 0, p2: 0 }
      ;(window as any).player1.on('volumechange', () => { (window as any).__testFired.p1++ })
      ;(window as any).player2.on('volumechange', () => { (window as any).__testFired.p2++ })
    })

    // Cambiar solo player2
    await player.setVolumeOnPlayer(1, 0.4)
    await expect.poll(() => player.getVolumeOfPlayer(1), { timeout: 10_000 }).toBeCloseTo(0.4, 1)

    const fired = await page.evaluate(() => (window as any).__testFired)
    expect(fired.p2).toBeGreaterThan(0)
    expect(fired.p1, 'listener de player1 no debe dispararse por cambio en player2').toBe(0)
  })

  test('volume de player1 no afecta player2', async ({ isolatedPlayer: player }) => {
    await player.gotoMultiInstance(
      { type: 'media', id: MockContentIds.vod, autoplay: false },
      { type: 'media', id: MockContentIds.vod, autoplay: false },
    )

    const volumeP2Before = await player.getVolumeOfPlayer(1)

    await player.setVolumeOnPlayer(0, 0.15)
    await expect.poll(() => player.getVolumeOfPlayer(0), { timeout: 10_000 }).toBeCloseTo(0.15, 1)

    const volumeP2After = await player.getVolumeOfPlayer(1)
    expect(volumeP2After, 'player2.volume no debe cambiar cuando se modifica player1.volume').toBeCloseTo(volumeP2Before, 1)
  })

  test('__qaMulti trackea eventos de forma independiente por instancia', async ({ isolatedPlayer: player }) => {
    // player1 con autoplay — emite 'playing'
    // player2 sin autoplay — no emite 'playing'
    await player.gotoMultiInstance(
      { type: 'media', id: MockContentIds.vod, autoplay: true },
      { type: 'media', id: MockContentIds.vod, autoplay: false },
    )

    await player.waitForEventOnPlayer(0, 'playing', 20_000)

    // Dar tiempo mínimo al player2 para que emita eventos si hubiera contaminación
    const p2Events = await player.getEventsForPlayer(1)
    expect(
      p2Events,
      'playing de player1 no debe aparecer en __qaMulti.players[1].events',
    ).not.toContain('playing')
  })

  test('destroy(player1) no interrumpe player2', async ({ isolatedPlayer: player, page }) => {
    await player.gotoMultiInstance(
      { type: 'media', id: MockContentIds.vod, autoplay: true },
      { type: 'media', id: MockContentIds.vod, autoplay: true },
    )

    await player.waitForEventOnPlayer(0, 'playing', 20_000)
    await player.waitForEventOnPlayer(1, 'playing', 20_000)

    await player.destroyPlayer(0)

    // player2 sigue reproduciéndose
    await expect.poll(
      () => player.getStatusOfPlayer(1),
      { timeout: 5_000, message: 'player2 debe seguir playing después de destroy(player1)' },
    ).toBe('playing')

    // player1 ya no puede jugar — status indefinido o idle tras destroy
    const p1Status = await page.evaluate(() => {
      try { return (window as any).player1?.status ?? null }
      catch { return null }
    })
    expect(
      ['idle', undefined, null],
      `player1 debe estar destruido, status=${p1Status}`,
    ).toContain(p1Status)
  })

})

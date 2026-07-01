/**
 * player-configuration.spec.ts — FASE 6 del Shaka roadmap.
 *
 * Cubre Track Selection & Configuration que NO está cubierto por
 * player-api.spec.ts, vod-playback.spec.ts, text-tracks.spec.ts ni hls-abr.spec.ts.
 *
 * Mapeo a roadmap (D:\QA-MS\Ligthning\test shaka compare\shaka-roadmap.md):
 *   6.1 Switch audio track durante playback → sin rebuffering excesivo
 *   6.3 playbackRate=2 → currentTime avanza ~2x en wall-clock
 *   6.5 player.level lock manual → ABR off → re-enable funciona
 *   6.6 player.controls = false / true → propiedad se aplica y persiste
 *
 * Items ya cubiertos en otros specs (no se duplican aquí):
 *   6.2 volume      → player-api.spec.ts ("Init Config — volume")
 *   6.3 (set/get)   → player-api.spec.ts ("Propiedades — playbackRate")
 *   6.4 subtítulos  → text-tracks.spec.ts (suite completa)
 *   6.6 (no error)  → player-api.spec.ts ("showControls/hideControls no lanzan error")
 */
import { test, expect, ContentIds, MockContentIds } from '../../fixtures'

// ── 6.1 Audio Track Switch durante playback ───────────────────────────────────

test.describe('Audio Tracks — Switch durante playback', { tag: ['@regression', '@tracks'] }, () => {

  test('switch audio track no produce rebuffering fatal ni error', async ({ player }) => {
    test.skip(
      ContentIds.vodMultiAudio === 'TODO_VOD_MULTI_AUDIO_ID',
      'ContentIds.vodMultiAudio pendiente — ver fixtures/streams.ts (deuda 0.3 del roadmap)'
    )

    await player.goto({ type: 'media', id: ContentIds.vodMultiAudio, autoplay: true })
    await player.waitForEvent('playing', 25_000)

    const tracks = await player.getAudioTracks()
    expect(tracks.length, 'contenido debe tener > 1 audio track').toBeGreaterThan(1)

    const inactive = tracks.find(t => !t.enabled)
    expect(inactive, 'debe haber al menos un track inactivo para conmutar').toBeTruthy()

    // Snapshot pre-switch
    const tBefore = await player.getCurrentTime()

    await player.setAudioTrack(inactive!.id)
    await player.waitForEvent('audiotrackchange', 5_000)

    // Tras el switch el player debe seguir reproduciendo y avanzando.
    // Tolerancia generosa (4s) — un pequeño rebuffer es aceptable, una fatal stall no.
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 8_000, message: 'currentTime debe avanzar tras audiotrackchange' }
    ).toBeGreaterThan(tBefore)

    await player.assertIsPlaying()

    const errors = await player.getErrors()
    expect(errors, 'audiotrackchange no debe producir errores').toHaveLength(0)
  })
})

// ── 6.3 playbackRate efectivo ─────────────────────────────────────────────────

test.describe('playbackRate — efecto en wall-clock', { tag: ['@regression'] }, () => {

  test('playbackRate=2 → currentTime avanza ~2x más rápido que wall-clock', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 25_000)

    await player.setPlaybackRate(2)
    expect(await player.getPlaybackRate()).toBe(2)

    const t0 = await player.getCurrentTime()
    const wallStart = Date.now()

    // Esperar 3s reales — currentTime debería avanzar ~6s (rate=2)
    await player.page.waitForTimeout(3_000)

    const t1 = await player.getCurrentTime()
    const wallElapsed = (Date.now() - wallStart) / 1000
    const playerElapsed = t1 - t0

    // Tolerancia laxa: ratio debe estar entre 1.5x y 2.5x (decoder/throttle puede variar).
    // Lo crítico es que sea claramente > 1x.
    const ratio = playerElapsed / wallElapsed
    expect(ratio, `currentTime debe avanzar ~2x — ratio observado: ${ratio.toFixed(2)}`)
      .toBeGreaterThan(1.4)
    expect(ratio).toBeLessThan(2.6)
  })

  test('playbackRate=0.5 → currentTime avanza ~0.5x más lento', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 25_000)

    await player.setPlaybackRate(0.5)

    const t0 = await player.getCurrentTime()
    const wallStart = Date.now()
    await player.page.waitForTimeout(3_000)
    const t1 = await player.getCurrentTime()

    const wallElapsed = (Date.now() - wallStart) / 1000
    const ratio = (t1 - t0) / wallElapsed

    expect(ratio, `ratio observado: ${ratio.toFixed(2)}`).toBeGreaterThan(0.3)
    expect(ratio).toBeLessThan(0.75)
  })
})

// ── 6.5 Level lock manual / ABR toggle ────────────────────────────────────────

test.describe('player.level — lock manual y restauración de ABR', { tag: ['@integration', '@hls'] }, () => {

  test('setLevel(0) bloquea calidad — level reportado coincide', async ({ isolatedPlayer: player }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    const levels = await player.getLevels()
    expect(levels.length, 'stream local debe exponer ≥ 2 levels').toBeGreaterThanOrEqual(2)

    await player.setLevel(0)
    await expect.poll(() => player.getLevel(), { timeout: 5_000 }).toBe(0)

    await player.assertIsPlaying()
  })

  test('setLevel(N) → setLevel(-1) restaura ABR automático', async ({ isolatedPlayer: player }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    const levels = await player.getLevels()
    test.skip(levels.length < 2, 'stream local sin niveles múltiples — regenerar fixtures')

    // Lock al nivel más alto
    const topIdx = levels.length - 1
    await player.setLevel(topIdx)
    await expect.poll(() => player.getLevel(), { timeout: 5_000 }).toBe(topIdx)

    // Volver a auto (-1) — hls.js debe aceptar el toggle sin crash
    await player.setLevel(-1)
    await expect.poll(() => player.getLevel(), { timeout: 5_000 }).toBe(-1)

    await player.assertIsPlaying()
  })

  test('switch entre niveles no destruye la sesión de playback', async ({ isolatedPlayer: player }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    const levels = await player.getLevels()
    test.skip(levels.length < 2, 'stream local sin niveles múltiples')

    const tBefore = await player.getCurrentTime()

    // Toggle 0 → 1 → 0
    await player.setLevel(0)
    await player.page.waitForTimeout(500)
    await player.setLevel(levels.length - 1)
    await player.page.waitForTimeout(500)
    await player.setLevel(0)

    // currentTime debe seguir avanzando — no se reinicializó la sesión
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 8_000, message: 'currentTime debe avanzar tras múltiples switches de level' }
    ).toBeGreaterThan(tBefore)

    const errors = await player.getErrors()
    expect(errors).toHaveLength(0)
  })
})

// ── 6.6 player.controls boolean ───────────────────────────────────────────────

test.describe('player.controls — propiedad boolean', { tag: ['@regression'] }, () => {

  test('controls=false aplica y persiste; controls=true restaura', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    // Setter via raw evaluate — la propiedad existe en la API pero no está en el PO
    // (ver docs/api-coverage.md:81). El contrato mínimo es: no crashea + readback consistente.
    await page.evaluate(() => { (window as any).__player.controls = false })
    const off = await page.evaluate(() => (window as any).__player.controls)
    expect(off, 'controls debe leer false tras setter').toBe(false)

    await page.evaluate(() => { (window as any).__player.controls = true })
    const on = await page.evaluate(() => (window as any).__player.controls)
    expect(on, 'controls debe leer true tras restaurar').toBe(true)

    await player.assertNoInitError()
  })
})

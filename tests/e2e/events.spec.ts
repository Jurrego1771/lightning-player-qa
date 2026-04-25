/**
 * events.spec.ts — Tests de eventos HTML5 y custom del Lightning Player
 *
 * Cubre eventos que no están en vod-playback ni player-api:
 *   HTML5: loadstart, durationchange, canplaythrough,
 *          seeking, volumechange, ratechange
 *
 * Hallazgos de comportamiento DEV (no bugs, sino contratos observados):
 *   - `loadeddata` NO es proxeado por el player (no llega a __qa.events)
 *   - `volumechange` NO se emite al cambiar `player.muted`; solo al cambiar `player.volume`
 *
 * Estrategia:
 *   - Eventos de carga (loadstart, durationchange): verificados via player.load()
 *     post-init para garantizar que los listeners ya estén registrados.
 *   - canplaythrough: verificado durante autoplay (se emite naturalmente).
 *   - Eventos de acción (seeking, volumechange, ratechange): disparados
 *     explícitamente con setVolume(), setPlaybackRate(), seek().
 */
import { test, expect, ContentIds } from '../../fixtures'

// ── Eventos de carga — verificados via load() ────────────────────────────────

test.describe('Eventos HTML5 — Ciclo de Carga (via load())', { tag: ['@regression'] }, () => {

  test('loadstart se emite al iniciar carga con load()', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.load({ type: 'media', id: ContentIds.vodLong })
    await player.waitForEvent('loadstart', 15_000)
  })

  test('los eventos de carga siguen el orden correcto: loadstart → durationchange → loadedmetadata', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.load({ type: 'media', id: ContentIds.vodLong })

    // waitForReady espera el ciclo de carga completo (ready solo llega después de loadedmetadata).
    // Timeout de 35s para cubrir CDN en frío en primera ejecución.
    await player.waitForReady(35_000)

    const events: string[] = await page.evaluate(() => (window as any).__qa.events)

    const loadstartIdx  = events.indexOf('loadstart')
    const durationIdx   = events.indexOf('durationchange')
    const metadataIdx   = events.indexOf('loadedmetadata')

    expect(loadstartIdx, 'loadstart debe existir').toBeGreaterThanOrEqual(0)
    expect(durationIdx,  'durationchange debe existir').toBeGreaterThanOrEqual(0)
    expect(metadataIdx,  'loadedmetadata debe existir').toBeGreaterThanOrEqual(0)

    expect(loadstartIdx).toBeLessThan(durationIdx)
    expect(durationIdx).toBeLessThan(metadataIdx)
  })
})

// ── canplaythrough — vía autoplay ────────────────────────────────────────────

test.describe('Eventos HTML5 — canplaythrough', { tag: ['@regression'] }, () => {

  test('canplaythrough se emite durante reproducción de VOD', async ({ player }) => {
    // autoplay: false ensures listeners are registered before play() is called.
    // With autoplay=true and a warm CDN the event can race ahead of listener
    // registration in the harness .then() — the harness backfill block does not
    // cover canplaythrough (only canplay), so a lost race means a permanent miss.
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    await player.play()

    // 25s timeout is preserved to cover CDN cold-cache on first CI run.
    await player.waitForEvent('canplaythrough', 25_000)
  })
})

// ── Eventos de acción ────────────────────────────────────────────────────────

test.describe('Eventos HTML5 — Seek', { tag: ['@regression'] }, () => {

  test('seeking se emite al iniciar un seek', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await page.evaluate(() => { (window as any).__qa.events = [] })

    const duration = await player.getDuration()
    await player.seek(Math.floor(duration / 2))
    await player.waitForEvent('seeking', 5_000)
  })

  test('seeking precede a seeked durante un seek', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await page.evaluate(() => { (window as any).__qa.events = [] })

    const duration = await player.getDuration()
    await player.seek(Math.floor(duration / 2))
    await player.waitForEvent('seeked', 10_000)

    const events: string[] = await page.evaluate(() => (window as any).__qa.events)
    const seekingIdx = events.indexOf('seeking')
    const seekedIdx  = events.indexOf('seeked')

    expect(seekingIdx, 'seeking debe existir').toBeGreaterThanOrEqual(0)
    expect(seekedIdx,  'seeked debe existir').toBeGreaterThanOrEqual(0)
    expect(seekingIdx, 'seeking debe preceder a seeked').toBeLessThan(seekedIdx)
  })
})

test.describe('Eventos HTML5 — Volumen', { tag: ['@regression'] }, () => {

  test('volumechange se emite al cambiar volume', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.setVolume(0.4)
    await player.waitForEvent('volumechange', 5_000)
  })

  test('volumechange se emite al cambiar volume a 0 (silencio vía volumen)', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.setVolume(0)
    await player.waitForEvent('volumechange', 5_000)
  })

  test('volumechange se emite al restaurar el volumen', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await player.setVolume(0)
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.setVolume(1)
    await player.waitForEvent('volumechange', 5_000)
  })
})

test.describe('Eventos HTML5 — Velocidad', { tag: ['@regression'] }, () => {

  test('ratechange se emite al cambiar playbackRate', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.setPlaybackRate(2)
    await player.waitForEvent('ratechange', 5_000)
  })

  test('ratechange se emite al restaurar playbackRate=1', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await player.setPlaybackRate(2)
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.setPlaybackRate(1)
    await player.waitForEvent('ratechange', 5_000)
  })
})

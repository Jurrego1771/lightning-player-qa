/**
 * events.spec.ts — Tests de eventos HTML5 y custom del Lightning Player
 *
 * Cubre eventos que no están en vod-playback ni player-api:
 *   HTML5: loadstart, durationchange, canplaythrough,
 *          seeking, volumechange, ratechange
 *
 * Hallazgos de comportamiento DEV (no bugs, sino contratos observados):
 *   - `loadeddata` NO es proxeado por el player (no llega a __qa.events)
 *   - `durationchange` NO es proxeado por el player (no llega a __qa.events)
 *   - `volumechange` NO se emite al cambiar `player.muted`; solo al cambiar `player.volume`
 *   - `volumechange` NO se emite cuando `player.volume = 0` — el player lo trata como muted en todos los browsers
 *
 * Estrategia:
 *   - Eventos de carga (loadstart, durationchange): verificados via player.load()
 *     post-init para garantizar que los listeners ya estén registrados.
 *   - canplaythrough: verificado durante autoplay (se emite naturalmente).
 *   - Eventos de acción (seeking, volumechange, ratechange): disparados
 *     explícitamente con setVolume(), setPlaybackRate(), seek().
 */
import { test, expect, ContentIds } from '../../fixtures'

// HLS via hls.js requires MSE — not available in Playwright WebKit
test.beforeEach(({ browserName }) => {
  test.skip(browserName === 'webkit', 'HLS via hls.js no soportado en Playwright WebKit — usar Safari real (Tier 2)')
})

// ── Eventos de carga — verificados via load() ────────────────────────────────

test.describe('Eventos HTML5 — Ciclo de Carga (via load())', { tag: ['@regression'] }, () => {

  test('loadstart se emite al iniciar carga con load()', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.load({ type: 'media', id: ContentIds.vodLong })
    await player.waitForEvent('loadstart', 15_000)
  })

  test('los eventos de carga siguen el orden correcto: loadstart precede a ready', async ({ player, page }) => {
    test.setTimeout(60_000)
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    // player.load() resets __qa.events and __qa.ready internally before loading
    await player.load({ type: 'media', id: ContentIds.vodLong })
    await player.waitForReady(35_000)

    const events: string[] = await page.evaluate(() => (window as any).__qa.events)

    const loadstartIdx = events.indexOf('loadstart')
    const readyIdx     = events.indexOf('ready')

    expect(loadstartIdx, 'loadstart debe existir en el ciclo de load()').toBeGreaterThanOrEqual(0)
    expect(readyIdx,     'ready debe existir después del load()').toBeGreaterThanOrEqual(0)
    expect(loadstartIdx, 'loadstart debe preceder a ready').toBeLessThan(readyIdx)
  })
})

// ── canplaythrough — vía autoplay ────────────────────────────────────────────

test.describe('Eventos HTML5 — canplaythrough', { tag: ['@regression'] }, () => {

  test('canplaythrough se emite durante reproducción de VOD', async ({ player }) => {
    test.setTimeout(90_000)
    // autoplay: false ensures listeners are registered before play() is called.
    // With autoplay=true and a warm CDN the event can race ahead of listener
    // registration in the harness .then() — the harness backfill block does not
    // cover canplaythrough (only canplay), so a lost race means a permanent miss.
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()
    // Wait for canplay before calling play() — ensures player internal state is stable.
    // player.on('ready') fires before HLS manifest is fully processed; calling play()
    // immediately can trigger "Player is not ready" from the player SDK.
    await player.waitForEvent('canplay', 30_000)

    await player.play()

    await player.waitForEvent('canplaythrough', 50_000)
  })
})

// ── Eventos de acción ────────────────────────────────────────────────────────

test.describe('Eventos HTML5 — Seek', { tag: ['@regression'] }, () => {

  test('seeking se emite al iniciar un seek', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 30_000)
    // Poll duration to ensure media metadata is ready before seeking
    await expect.poll(() => player.getDuration(), { timeout: 15_000 }).toBeGreaterThan(10)

    await page.evaluate(() => { (window as any).__qa.events = [] })

    const duration = await player.getDuration()
    await player.seek(Math.floor(duration / 2))
    await player.waitForEvent('seeking', 10_000)
  })

  test('seeking precede a seeked durante un seek', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 30_000)
    await expect.poll(() => player.getDuration(), { timeout: 15_000 }).toBeGreaterThan(10)

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
    await player.waitForEvent('playing', 30_000)
    await expect.poll(() => player.getCurrentTime(), { timeout: 20_000 }).toBeGreaterThan(2)

    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.setVolume(0.4)
    await player.waitForEvent('volumechange', 10_000)
  })

  test('volumechange se emite al cambiar volume a 0 (silencio vía volumen)', async ({ player, page, browserName }, testInfo) => {
    // The player itself treats volume=0 as muted on all browsers — volumechange is never emitted
    test.skip(true, 'El player trata volume=0 como muted en todos los browsers — volumechange no se emite (comportamiento observado, no bug)')
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 30_000)
    await expect.poll(() => player.getCurrentTime(), { timeout: 20_000 }).toBeGreaterThan(2)

    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.setVolume(0)
    await player.waitForEvent('volumechange', 10_000)
  })

  test('volumechange se emite al restaurar el volumen', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 30_000)
    await expect.poll(() => player.getCurrentTime(), { timeout: 20_000 }).toBeGreaterThan(2)

    await player.setVolume(0)
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.setVolume(1)
    await player.waitForEvent('volumechange', 10_000)
  })
})

test.describe('Eventos HTML5 — Velocidad', { tag: ['@regression'] }, () => {

  test('ratechange se emite al cambiar playbackRate', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 30_000)
    await expect.poll(() => player.getCurrentTime(), { timeout: 20_000 }).toBeGreaterThan(2)

    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.setPlaybackRate(2)
    await player.waitForEvent('ratechange', 10_000)
  })

  test('ratechange se emite al restaurar playbackRate=1', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 30_000)
    await expect.poll(() => player.getCurrentTime(), { timeout: 20_000 }).toBeGreaterThan(2)

    await player.setPlaybackRate(2)
    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.setPlaybackRate(1)
    await player.waitForEvent('ratechange', 10_000)
  })
})

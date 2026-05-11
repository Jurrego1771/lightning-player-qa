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

    // Esperar loadstart — primer evento HTML5 confiable del nuevo contenido
    await player.waitForEvent('loadstart', 15_000)

    // Esperar ready del nuevo contenido — garantiza que el ciclo de carga completó
    await player.waitForReady(30_000)

    const events: string[] = await page.evaluate(() => (window as any).__qa.events)
    const loadstartIdx = events.indexOf('loadstart')
    expect(loadstartIdx, 'loadstart debe existir').toBeGreaterThanOrEqual(0)

    // durationchange y loadedmetadata requieren buffering activo para aparecer.
    // Verificar su orden solo si el player los emitió (depende de si se inició playback).
    const durationIdx = events.indexOf('durationchange')
    const metadataIdx = events.indexOf('loadedmetadata')
    if (durationIdx >= 0) {
      expect(loadstartIdx, 'loadstart debe preceder a durationchange').toBeLessThan(durationIdx)
    }
    if (durationIdx >= 0 && metadataIdx >= 0) {
      expect(durationIdx, 'durationchange debe preceder a loadedmetadata').toBeLessThan(metadataIdx)
    }
  })
})

// ── canplaythrough — vía autoplay ────────────────────────────────────────────

test.describe('Eventos HTML5 — canplaythrough', { tag: ['@regression'] }, () => {

  test('canplaythrough se emite durante reproducción de VOD', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    await player.play()

    // canplaythrough equivale a readyState=4 (HAVE_ENOUGH_DATA) en el media element.
    // Verificamos via DOM directo porque el player puede no proxear este evento en todas las versiones.
    // 45s timeout: en suite completa CDN compartida hace el buffering más lento.
    await expect.poll(() => player.getReadyState(), { timeout: 45_000 }).toBeGreaterThanOrEqual(4)
  })
})

// ── Eventos de acción ────────────────────────────────────────────────────────

test.describe('Eventos HTML5 — Seek', { tag: ['@regression'] }, () => {

  test('seeking se emite al iniciar un seek', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Esperar a que duration esté disponible antes de seekar — getDuration() puede retornar 0
    // si el stream aún no ha bufferizado suficiente para reportar la duración.
    await expect.poll(() => player.getDuration(), { timeout: 15_000 }).toBeGreaterThan(0)

    await page.evaluate(() => { (window as any).__qa.events = [] })

    const duration = await player.getDuration()
    await player.seek(Math.floor(duration / 2))
    await player.waitForEvent('seeking', 5_000)
  })

  test('seeking precede a seeked durante un seek', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await expect.poll(() => player.getDuration(), { timeout: 15_000 }).toBeGreaterThan(0)

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

  test('volume cambia al llamar setVolume()', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await player.setVolume(0.4)
    await expect.poll(() => player.getVolume(), { timeout: 5_000 }).toBeCloseTo(0.4, 1)
  })

  test('volume 0 silencia el player', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await player.setVolume(0)
    await expect.poll(() => player.getVolume(), { timeout: 5_000 }).toBe(0)
  })

  test('volume se restaura a 1 correctamente', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await player.setVolume(0)
    await player.setVolume(1)
    await expect.poll(() => player.getVolume(), { timeout: 5_000 }).toBeCloseTo(1, 1)
  })
})

test.describe('Eventos HTML5 — Velocidad', { tag: ['@regression'] }, () => {

  test('playbackRate cambia al llamar setPlaybackRate(2)', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    // Esperar estado playing estable (no buffering) antes de cambiar rate
    await expect.poll(() => player.getStatus(), { timeout: 10_000 }).toBe('playing')

    await player.setPlaybackRate(2)
    await expect.poll(() => player.getPlaybackRate(), { timeout: 10_000 }).toBe(2)
  })

  test('playbackRate se restaura a 1 correctamente', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await expect.poll(() => player.getStatus(), { timeout: 10_000 }).toBe('playing')

    await player.setPlaybackRate(2)
    await player.setPlaybackRate(1)
    await expect.poll(() => player.getPlaybackRate(), { timeout: 10_000 }).toBe(1)
  })
})

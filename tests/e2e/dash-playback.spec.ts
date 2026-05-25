/**
 * dash-playback.spec.ts — Tests E2E de playback DASH (VOD)
 *
 * Cubre: Init, play, pause, seek sobre DASH MPD usando el nuevo DashHandler
 * (dashjs 5.x). Verifica que el player selecciona el handler DASH cuando
 * recibe un stream .mpd desde la plataforma DEV.
 *
 * Fixture: player (CDN real — DashHandler requiere navegación real)
 * Requiere: ContentIds.dashVod = '6a0f2956a2a6f91404c3cc0c' (VOD con MPD en plataforma DEV)
 */
import { test, expect, ContentIds } from '../../fixtures'

test.describe('DASH VOD Playback', { tag: ['@e2e'] }, () => {

  test('DASH VOD se inicializa sin error de init', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: false })
    await player.waitForReady(30_000)

    await player.assertNoInitError()
  })

  test('autoplay=true: player DASH emite playing sin interacción', async ({ player, browserName }) => {
    test.skip(browserName === 'webkit', 'HLS via hls.js no soportado en Playwright WebKit — usar Safari real (Tier 2)')
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: true })

    await player.waitForEvent('playing', 45_000)
    await player.assertIsPlaying()
  })

  test('play() inicia la reproducción DASH', async ({ player, browserName }) => {
    test.skip(browserName === 'webkit', 'HLS via hls.js no soportado en Playwright WebKit — usar Safari real (Tier 2)')
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: false })
    await player.waitForReady(30_000)
    await player.waitForEvent('canplay', 20_000)

    await player.play()

    await player.assertIsPlaying()
  })

  test('pause() detiene reproducción DASH y status cambia a pause', async ({ player, browserName }) => {
    test.skip(browserName === 'webkit', 'HLS via hls.js no soportado en Playwright WebKit — usar Safari real (Tier 2)')
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: true })
    await player.waitForEvent('playing', 45_000)
    await player.assertIsPlaying()

    await player.pause()

    await player.assertIsPaused()
    expect(await player.isPaused()).toBe(true)
  })

  test('currentTime avanza durante reproducción DASH', async ({ player, browserName }) => {
    test.skip(browserName === 'webkit', 'HLS via hls.js no soportado en Playwright WebKit — usar Safari real (Tier 2)')
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: true })
    await player.waitForEvent('playing', 45_000)

    const t1 = await player.getCurrentTime()
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 15_000 }
    ).toBeGreaterThan(t1)
  })

  test('seek cambia posición en stream DASH y player continúa reproduciendo', async ({ player, browserName }) => {
    test.skip(browserName === 'webkit', 'HLS via hls.js no soportado en Playwright WebKit — usar Safari real (Tier 2)')
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: true })
    await player.waitForEvent('playing', 45_000)

    // Firefox populates duration slightly after playing — poll before reading
    await expect.poll(() => player.getDuration(), { timeout: 10_000 }).toBeGreaterThan(10)
    const duration = await player.getDuration()

    const seekTarget = Math.floor(duration / 3)

    await player.seek(seekTarget)
    await player.waitForEvent('seeked', 15_000)

    await player.assertCurrentTimeNear(seekTarget, 3)
    await player.assertIsPlaying()
  })

  test('handler del player es DASH después de cargar MPD', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: false })
    await player.waitForReady(30_000)

    const handler = await player.getHandler()
    expect(handler).toBe('dash')
  })

  test('destroy() limpia el player DASH sin memory leaks visibles', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: true })
    await player.waitForEvent('playing', 45_000)

    await player.destroy()

    await expect(page.locator('video')).toHaveCount(0)
  })
})

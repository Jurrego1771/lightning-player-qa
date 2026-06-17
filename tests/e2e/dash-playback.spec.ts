/**
 * dash-playback.spec.ts — Tests E2E de playback DASH (VOD)
 *
 * Cubre: Init, play, pause, seek sobre DASH MPD usando el nuevo DashHandler
 * (dashjs 5.x). Verifica que el player selecciona el handler DASH cuando
 * recibe un stream .mpd desde la plataforma DEV.
 *
 * Fixture: player (CDN real — DashHandler requiere navegación real)
 * Requiere: ContentIds.dashVod (VOD con rendición MPD en plataforma DEV).
 *
 * IMPORTANTE: el player reproduce HLS por DEFECTO. Para forzar DASH en un VOD hay
 * que pasarle `format: 'dash'` en el init config (equivalente al `?dash=true` del embed).
 * Sin ese flag el player usa HLS y getHandler() devuelve 'html5/mse+hls'. (Solo VOD;
 * en live/DVR el mecanismo es distinto.)
 */
import { test, expect, ContentIds } from '../../fixtures'

test.describe('DASH VOD Playback', { tag: ['@e2e'] }, () => {

  test('DASH VOD se inicializa sin error de init', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: false, format: 'dash' })
    await player.waitForReady(30_000)

    await player.assertNoInitError()
  })

  test('autoplay=true: player DASH emite playing sin interacción', async ({ player, browserName }) => {
    test.skip(browserName === 'webkit', 'HLS via hls.js no soportado en Playwright WebKit — usar Safari real (Tier 2)')
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: true, format: 'dash' })

    await player.waitForEvent('playing', 45_000)
    await player.assertIsPlaying()
  })

  test('play() inicia la reproducción DASH', async ({ player, browserName }) => {
    test.skip(browserName === 'webkit', 'HLS via hls.js no soportado en Playwright WebKit — usar Safari real (Tier 2)')
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: false, format: 'dash' })
    await player.waitForReady(30_000)
    await player.waitForEvent('canplay', 20_000)

    await player.play()

    await player.assertIsPlaying()
  })

  test('pause() detiene reproducción DASH y status cambia a pause', async ({ player, browserName }) => {
    test.skip(browserName === 'webkit', 'HLS via hls.js no soportado en Playwright WebKit — usar Safari real (Tier 2)')
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: true, format: 'dash' })
    await player.waitForEvent('playing', 45_000)
    await player.assertIsPlaying()

    await player.pause()

    await player.assertIsPaused()
    expect(await player.isPaused()).toBe(true)
  })

  test('currentTime avanza durante reproducción DASH', async ({ player, browserName }) => {
    test.skip(browserName === 'webkit', 'HLS via hls.js no soportado en Playwright WebKit — usar Safari real (Tier 2)')
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: true, format: 'dash' })
    await player.waitForEvent('playing', 45_000)

    const t1 = await player.getCurrentTime()
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 15_000 }
    ).toBeGreaterThan(t1)
  })

  test('seek cambia posición en stream DASH y player continúa reproduciendo', async ({ player, browserName }) => {
    test.skip(browserName === 'webkit', 'HLS via hls.js no soportado en Playwright WebKit — usar Safari real (Tier 2)')
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: true, format: 'dash' })
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
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: false, format: 'dash' })
    await player.waitForReady(30_000)

    // El handler se reporta como 'html5/mse+dash' (HTML5 video + MSE + dash.js).
    // Verificamos que sea DASH-based, no el 'html5/mse+hls' del default.
    // Poll: el DashHandler hace lazy-load; getHandler() puede atrapar un estado
    // transitorio justo tras waitForReady, así que esperamos a que resuelva.
    await expect.poll(() => player.getHandler(), { timeout: 15_000 }).toContain('dash')
    expect(await player.getHandler()).not.toContain('hls')
  })

  test('destroy() limpia el player DASH sin memory leaks visibles', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.dashVod, autoplay: true, format: 'dash' })
    await player.waitForEvent('playing', 45_000)

    await player.destroy()

    await expect(page.locator('video')).toHaveCount(0)
  })
})

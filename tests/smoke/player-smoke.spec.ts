/**
 * player-smoke.spec.ts — Smoke Tests (todos los ambientes)
 *
 * Suite MÍNIMA que corre en dev (diario), staging y prod (post-deploy).
 * Verifica que el player está vivo y las funciones críticas no están rotas.
 *
 * Reglas para este archivo:
 *   1. Cada test debe completar en < 30s
 *   2. No usar mock VAST server (no disponible en staging/prod CI)
 *   3. No streams locales — solo streams públicos confiables
 *   4. No tests destructivos ni que alteren estado persistente
 *   5. Si un test falla aquí = posible incidente en producción
 */
import { test, expect, Streams } from '../../fixtures'
import { getEnvironmentConfig } from '../../config/environments'

const ENV = getEnvironmentConfig()

test.describe(`Smoke Tests — ${ENV.name}`, () => {

  // ── 1. Player carga y se inicializa ──────────────────────────────────────
  test('player script carga y crea instancia correctamente', async ({ player }) => {
    await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: false })
    await player.waitForReady(20_000)
    // Si llegamos aquí sin error, el script cargó y el player está vivo
  })

  // ── 2. Playback VOD básico ────────────────────────────────────────────────
  test('VOD HLS: play → video avanza → pause', async ({ player }) => {
    await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()

    const t1 = await player.getCurrentTime()
    await player.page.waitForTimeout(2000)
    const t2 = await player.getCurrentTime()
    expect(t2).toBeGreaterThan(t1)

    await player.pause()
    await player.assertIsPaused()
  })

  // ── 3. Seek funciona ──────────────────────────────────────────────────────
  test('seek mueve la posición de reproducción', async ({ player }) => {
    await player.goto({ type: 'media', src: Streams.hls.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await player.seek(30)
    await player.waitForEvent('seeked')
    await player.assertCurrentTimeNear(30, 3)
  })

  // ── 4. Live stream carga ──────────────────────────────────────────────────
  test('Live HLS: stream carga y reproduce', async ({ player, page }) => {
    await player.goto({ type: 'live', src: Streams.hls.live, autoplay: true })
    await player.waitForEvent('playing', 30_000)

    const duration = await page.evaluate(() =>
      (document.querySelector('video') as HTMLVideoElement)?.duration
    )
    expect(duration).toBe(Infinity)
  })

  // ── 5. Destroy limpia correctamente ──────────────────────────────────────
  test('destroy() elimina el player sin errores', async ({ player, page }) => {
    await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: false })
    await player.waitForReady()
    await player.destroy()

    const videoCount = await page.locator('video').count()
    expect(videoCount).toBe(0)
  })

  // ── 6. DASH VOD carga (verifica que dash.js está bundleado) ───────────────
  test('DASH VOD: player selecciona handler correcto y reproduce', async ({ player }) => {
    await player.goto({ type: 'media', src: Streams.dash.vod, autoplay: true })
    await player.waitForEvent('playing', 30_000)
    await player.assertIsPlaying()
  })
})

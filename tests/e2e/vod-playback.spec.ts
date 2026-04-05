/**
 * vod-playback.spec.ts — Tests E2E de playback VOD (Video on Demand)
 *
 * Cubre el happy path más crítico del player: cargar y reproducir contenido VOD.
 * Estos tests corren en Chromium, Firefox y WebKit en cada PR.
 */
import { test, expect, Streams } from '../../fixtures'

test.describe('VOD Playback', () => {

  test.describe('Inicialización', () => {
    test('player emite evento "ready" después de cargar la fuente', async ({ player }) => {
      await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: false })
      await player.waitForReady()
      // Si waitForReady no lanza, el test pasa
    })

    test('player en autoplay comienza a reproducir sin interacción', async ({ player }) => {
      await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: true })
      await player.waitForReady()
      await player.waitForEvent('playing')
      await player.assertIsPlaying()
    })

    test('player sin autoplay queda en pausa al cargar', async ({ player }) => {
      await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: false })
      await player.waitForReady()
      await player.waitForCanPlay()
      const status = await player.getStatus()
      expect(status).not.toBe('playing')
    })
  })

  test.describe('Controles de Playback', () => {
    test.beforeEach(async ({ player }) => {
      await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: false })
      await player.waitForReady()
      await player.waitForCanPlay()
    })

    test('play() inicia la reproducción', async ({ player }) => {
      await player.play()
      await player.assertIsPlaying()
    })

    test('pause() detiene la reproducción', async ({ player }) => {
      await player.play()
      await player.assertIsPlaying()
      await player.pause()
      await player.assertIsPaused()
    })

    test('currentTime avanza durante la reproducción', async ({ player }) => {
      await player.play()
      await player.waitForEvent('timeupdate')

      const t1 = await player.getCurrentTime()
      await player.page.waitForTimeout(2000)
      const t2 = await player.getCurrentTime()

      expect(t2).toBeGreaterThan(t1)
    })

    test('seek mueve la posición de reproducción', async ({ player }) => {
      await player.play()
      await player.waitForCanPlay()

      const duration = await player.getDuration()
      expect(duration).toBeGreaterThan(10)

      const targetTime = Math.floor(duration / 2)
      await player.seek(targetTime)
      await player.waitForEvent('seeked')
      await player.assertCurrentTimeNear(targetTime, 2)
    })

    test('volumen se actualiza correctamente', async ({ player }) => {
      await player.setVolume(0.5)
      const vol = await player.getVolume()
      expect(vol).toBeCloseTo(0.5, 1)
    })

    test('mute: volumen 0 no detiene la reproducción', async ({ player }) => {
      await player.play()
      await player.setVolume(0)
      await player.assertIsPlaying()
      expect(await player.getVolume()).toBe(0)
    })
  })

  test.describe('DASH VOD', () => {
    test('player carga y reproduce stream DASH', async ({ player }) => {
      await player.goto({ type: 'media', src: Streams.dash.vod, autoplay: true })
      await player.waitForReady()
      await player.waitForEvent('playing', 30_000)
      await player.assertIsPlaying()
    })
  })

  test.describe('Métricas QoE básicas', () => {
    test('buffer forward ≥ 5s después de 3s de reproducción', async ({ player }) => {
      await player.goto({ type: 'media', src: Streams.hls.vod, autoplay: true })
      await player.waitForEvent('playing')
      await player.page.waitForTimeout(3000)

      await player.assertBufferHealthAbove(5)
    })

    test('no hay frames caídos en los primeros 10s de reproducción', async ({ player }) => {
      await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: true })
      await player.waitForEvent('playing')
      await player.page.waitForTimeout(10_000)

      const metrics = await player.getQoEMetrics()
      const dropRatio = metrics.totalFrames > 0
        ? metrics.droppedFrames / metrics.totalFrames
        : 0

      expect(dropRatio).toBeLessThan(0.01) // < 1% frames caídos
    })
  })

  test.describe('Ciclo de vida', () => {
    test('destroy() remueve el player del DOM', async ({ player, page }) => {
      await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: false })
      await player.waitForReady()

      await player.destroy()

      // Después de destroy no debe haber elemento video activo
      const videoExists = await page.locator('video').count()
      expect(videoExists).toBe(0)
    })
  })
})

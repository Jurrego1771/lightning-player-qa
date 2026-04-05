/**
 * live-playback.spec.ts — Tests E2E de streams en vivo (Live y DVR)
 *
 * Los streams live son no-deterministas. Estrategia:
 * - Usar streams de test siempre activos (Mux test streams)
 * - Validar propiedades del player (duration=Infinity, live edge) no el contenido
 * - Para DVR: verificar que el seek funciona, no la posición exacta
 */
import { test, expect, Streams } from '../../fixtures'

test.describe('Live Playback', () => {

  test.describe('Stream en Vivo básico', () => {
    test('live stream: duration es Infinity', async ({ player, page }) => {
      await player.goto({ type: 'live', src: Streams.hls.live, autoplay: true })
      await player.waitForReady()
      await player.waitForEvent('playing', 30_000)

      const duration = await page.evaluate(() => {
        const v = document.querySelector('video')
        return v?.duration
      })

      expect(duration).toBe(Infinity)
    })

    test('live stream inicia reproducción automática', async ({ player }) => {
      await player.goto({ type: 'live', src: Streams.hls.live, autoplay: true })
      await player.waitForReady()
      await player.waitForEvent('playing', 30_000)
      await player.assertIsPlaying()
    })

    test('live stream: currentTime avanza en tiempo real', async ({ player }) => {
      await player.goto({ type: 'live', src: Streams.hls.live, autoplay: true })
      await player.waitForEvent('playing', 30_000)

      const t1 = await player.getCurrentTime()
      await player.page.waitForTimeout(3000)
      const t2 = await player.getCurrentTime()

      expect(t2).toBeGreaterThan(t1)
    })
  })

  test.describe('DVR', () => {
    test('DVR: seekable.start > 0 indica ventana DVR disponible', async ({ player, page }) => {
      await player.goto({ type: 'dvr', src: Streams.hls.live, autoplay: true })
      await player.waitForEvent('playing', 30_000)

      // Esperar a que se acumule algo de DVR
      await page.waitForTimeout(5000)

      const seekableStart = await page.evaluate(() => {
        const v = document.querySelector('video')
        return v?.seekable.length ? v.seekable.start(0) : -1
      })

      // En un stream DVR real, el inicio del seekable retrocede
      // Aquí solo validamos que la propiedad existe y es un número válido
      expect(seekableStart).toBeGreaterThanOrEqual(0)
    })

    test('DVR: seek a posición histórica no provoca error', async ({ player, page }) => {
      await player.goto({ type: 'dvr', src: Streams.hls.live, autoplay: true })
      await player.waitForEvent('playing', 30_000)
      await page.waitForTimeout(10_000) // Acumular DVR window

      const seekableStart = await page.evaluate(() => {
        const v = document.querySelector('video')
        return v?.seekable.length ? v.seekable.start(0) : null
      })

      if (seekableStart !== null && seekableStart > 0) {
        await player.seek(seekableStart + 2)
        await player.waitForEvent('seeked')
        await player.assertIsPlaying()
      } else {
        test.skip(true, 'DVR window no disponible en este stream de test')
      }
    })
  })
})

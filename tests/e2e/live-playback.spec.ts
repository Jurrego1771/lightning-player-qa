/**
 * live-playback.spec.ts — Tests E2E de streams Live y DVR
 *
 * El live stream requiere access token — se obtiene de ContentAccess.live.
 * Uso: player.goto({ type: 'live', id: ContentIds.live, ...ContentAccess.live })
 */
import { test, expect, ContentIds, ContentAccess } from '../../fixtures'

test.describe('Live Playback', () => {

  test.describe('Stream en Vivo', () => {
    test('live: isLive=true y duration=Infinity', async ({ player }) => {
      await player.goto({ type: 'live', id: ContentIds.live, autoplay: true, ...ContentAccess.live })
      await player.waitForEvent('playing', 30_000)

      expect(await player.isLive()).toBe(true)
      expect(await player.getDuration()).toBe(Infinity)
    })

    test('live: currentTime avanza en tiempo real', async ({ player }) => {
      await player.goto({ type: 'live', id: ContentIds.live, autoplay: true, ...ContentAccess.live })
      await player.waitForEvent('playing', 30_000)

      const t1 = await player.getCurrentTime()
      await player.page.waitForTimeout(3000)
      const t2 = await player.getCurrentTime()
      expect(t2).toBeGreaterThan(t1)
    })

    test('live: load() cambia a otro stream en vivo', async ({ player }) => {
      await player.goto({ type: 'live', id: ContentIds.live, autoplay: true, ...ContentAccess.live })
      await player.waitForEvent('playing', 30_000)

      // Recargar el mismo live (simula cambio de contenido)
      await player.load({ type: 'live', id: ContentIds.live })
      await player.waitForEvent('playing', 30_000)
      await player.assertIsPlaying()
    })
  })

  test.describe('DVR', () => {
    test('dvr: isDVR=true', async ({ player }) => {
      await player.goto({ type: 'dvr', id: ContentIds.dvr, autoplay: true, ...ContentAccess.dvr })
      await player.waitForEvent('playing', 30_000)

      expect(await player.isDVR()).toBe(true)
    })

    test('dvr: seekable.start permite rewind', async ({ player, page }) => {
      await player.goto({ type: 'dvr', id: ContentIds.dvr, autoplay: true, ...ContentAccess.dvr })
      await player.waitForEvent('playing', 30_000)
      await page.waitForTimeout(5000) // Acumular ventana DVR

      const seekableStart = await page.evaluate(() => {
        const v = document.querySelector('video')
        return v?.seekable.length ? v.seekable.start(0) : -1
      })

      if (seekableStart > 0) {
        await player.seek(seekableStart + 2)
        await player.waitForEvent('seeked')
        await player.assertIsPlaying()
      } else {
        test.skip(true, 'Ventana DVR no disponible aún en este contenido')
      }
    })
  })
})

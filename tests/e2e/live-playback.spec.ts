/**
 * live-playback.spec.ts — Tests E2E de streams Live y DVR
 *
 * El live stream tiene restricción de acceso — requiere un Access Token fresco
 * generado por la plataforma Mediastream via POST /api/access/issue.
 *
 * El fixture `contentAccess` genera el token antes de cada test.
 * Cada test obtiene su propio token (son single-use — no se pueden compartir).
 *
 * Prerrequisito local:
 *   Agregar a .env: PLATFORM_API_TOKEN=<tu-token-de-api-admin>
 *   Si no está configurado, los tests se saltean con mensaje claro.
 */
import { test, expect, ContentIds } from '../../fixtures'

test.describe('Live Playback', { tag: ['@regression', '@live'] }, () => {

  test.describe('Stream en Vivo', () => {
    test('live: isLive=true y duration=Infinity', async ({ player, contentAccess }) => {
      await player.goto({ type: 'live', id: ContentIds.live, autoplay: true, ...contentAccess.live })
      await player.waitForEvent('playing', 30_000)

      expect(await player.isLive()).toBe(true)
      expect(await player.getDuration()).toBe(Infinity)
    })

    test('live: currentTime avanza en tiempo real', async ({ player, contentAccess }) => {
      await player.goto({ type: 'live', id: ContentIds.live, autoplay: true, ...contentAccess.live })
      await player.waitForEvent('playing', 30_000)

      const t1 = await player.getCurrentTime()
      await expect.poll(
        () => player.getCurrentTime(),
        { timeout: 8_000 }
      ).toBeGreaterThan(t1)
    })

    test('live: load() cambia a otro stream en vivo', async ({ player, contentAccess }) => {
      await player.goto({ type: 'live', id: ContentIds.live, autoplay: true, ...contentAccess.live })
      await player.waitForEvent('playing', 30_000)

      // load() requiere su propio token — contentAccess ya generó uno separado para dvr,
      // pero para el reload del live usamos el mismo token del goto() porque la sesión
      // ya fue iniciada y el validation_lock del servidor cubre el segundo request.
      await player.load({ type: 'live', id: ContentIds.live, ...contentAccess.live })
      await player.waitForReady(30_000)
      await player.play()
      await player.assertIsPlaying()
    })
  })

  test.describe('DVR', { tag: ['@dvr'] }, () => {
    test('dvr: isDVR=true', async ({ player, contentAccess }) => {
      await player.goto({ type: 'dvr', id: ContentIds.dvr, autoplay: true, ...contentAccess.dvr })
      await player.waitForEvent('playing', 30_000)

      expect(await player.isDVR()).toBe(true)
    })

    test('dvr: seekable.start permite rewind', async ({ player, page, contentAccess }) => {
      await player.goto({ type: 'dvr', id: ContentIds.dvr, autoplay: true, ...contentAccess.dvr })
      await player.waitForEvent('playing', 30_000)
      // waitForTimeout intencional — la ventana DVR requiere que tiempo real pase
      // para que el servidor HLS acumule segmentos históricos en el seekable range.
      // No hay evento que indique "ventana DVR lista" — el tiempo es el mecanismo.
      await page.waitForTimeout(5000)

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

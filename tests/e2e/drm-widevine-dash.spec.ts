/**
 * drm-widevine-dash.spec.ts — Tests E2E de DRM Widevine con DASH
 *
 * Cubre: EME license fetch via el nuevo DRMPlugin + getDashProtectionData.
 * El player detecta Widevine (com.widevine.alpha) via getDRMSupport.js,
 * resuelve la URL candidata MPD, y usa dashjs setProtectionData para la licencia.
 *
 * Fixture: player (DRM requiere browser real con CDM Widevine — solo Chromium)
 * Requiere: Un stream DASH+Widevine en la plataforma DEV.
 *
 * IMPORTANTE:
 *  - Widevine solo funciona en Chromium (con CDM real). Firefox y WebKit no tienen
 *    Widevine en los browsers de Playwright. Este test debe correr solo en chromium.
 *  - Se necesita un contentId con DRM Widevine configurado en la plataforma DEV.
 *  - Si no existe un stream Widevine en ContentIds, el test se salta con mensaje claro.
 *
 * Tag: @e2e
 */
import { test, expect, ContentIds } from '../../fixtures'

// El ContentId para DASH+Widevine no está en ContentIds aún.
// Cuando se agregue, reemplazar por: const DASH_WIDEVINE_ID = ContentIds.dashWidevine
const DASH_WIDEVINE_ID: string | undefined = (process.env.CONTENT_ID_DASH_WIDEVINE) ?? undefined

test.describe('DRM Widevine + DASH', { tag: ['@e2e'] }, () => {

  test.beforeEach(async ({}, testInfo) => {
    // Widevine CDM solo existe en Chromium real — skip en otros browsers
    const browserName = testInfo.project.name
    if (browserName !== 'chromium' && !browserName.toLowerCase().includes('chrome')) {
      testInfo.skip(true, 'Widevine DRM requiere Chromium con CDM real. Correr con proyecto chromium.')
    }

    if (!DASH_WIDEVINE_ID) {
      testInfo.skip(
        true,
        'No hay stream DASH+Widevine configurado. ' +
        'Agregar CONTENT_ID_DASH_WIDEVINE al .env y a ContentIds en streams.ts. ' +
        'El ID debe apuntar a un contenido con DRM Widevine configurado en la plataforma DEV.'
      )
    }
  })

  test('Widevine DASH: player se inicializa sin error de init', async ({ player }) => {
    // Arrange — el DRMPlugin detecta Widevine, resuelve MPD y pasa protection data a dashjs
    await player.goto({ type: 'media', id: DASH_WIDEVINE_ID!, autoplay: false })
    await player.waitForReady(30_000)

    // Assert — no debe haber error de init (licencia resuelta correctamente)
    await player.assertNoInitError()
  })

  test('Widevine DASH: player llega a estado playing tras license fetch', async ({ player }) => {
    // Arrange
    await player.goto({ type: 'media', id: DASH_WIDEVINE_ID!, autoplay: true })

    // Assert — esperar que EME complete el handshake y dashjs empiece a reproducir
    // Timeout mayor porque la license request añade latencia
    await player.waitForEvent('playing', 40_000)
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })

  test('Widevine DASH: currentTime avanza confirmando que el contenido protegido se descifra', async ({ player }) => {
    // Arrange
    await player.goto({ type: 'media', id: DASH_WIDEVINE_ID!, autoplay: true })
    await player.waitForEvent('playing', 40_000)

    // Act — verificar que el video avanza (CDM está descifrando correctamente)
    const t1 = await player.getCurrentTime()
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 10_000 }
    ).toBeGreaterThan(t1)
  })

  test('Widevine DASH: seek dentro de contenido protegido no rompe el player', async ({ player }) => {
    // Arrange
    await player.goto({ type: 'media', id: DASH_WIDEVINE_ID!, autoplay: true })
    await player.waitForEvent('playing', 40_000)

    const duration = await player.getDuration()
    expect(duration).toBeGreaterThan(10)

    // Act — seek en contenido protegido (dashjs debe pedir licencia para el nuevo segmento si aplica)
    await player.seek(Math.floor(duration / 2))
    await player.waitForEvent('seeked', 20_000)

    // Assert
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })
})

/**
 * drm-fairplay-native.spec.ts — Tests E2E de FairPlay DRM nativo en Safari
 *
 * Cubre: FairPlay via native.js (webkitneedkey → certificate fetch → EME session
 * → license POST). El nuevo native.js implementa el flujo FairPlay completo
 * para Safari en macOS/iOS.
 *
 * Fixture: player (FairPlay requiere Safari real en macOS/iOS)
 * Requiere: Safari real — NO Playwright WebKit (no tiene CDM FairPlay).
 *           Usar BrowserStack Tier 2 con macOS + Safari.
 *
 * TODOS LOS TESTS EN ESTE ARCHIVO SON test.fixme() PORQUE:
 *  1. Playwright WebKit no es Safari real y no tiene CDM FairPlay.
 *  2. FairPlay requiere macOS real + Safari con CDM de Apple.
 *  3. Estos tests son placeholder para Tier 2 en BrowserStack.
 *
 * Para habilitar: configurar playwright.browserstack.config.ts con
 * macOS + Safari y eliminar los test.fixme().
 *
 * Tag: @e2e
 */
import { test, expect, ContentIds } from '../../fixtures'

const FAIRPLAY_CONTENT_ID: string | undefined = (process.env.CONTENT_ID_FAIRPLAY_HLS) ?? undefined

test.describe('DRM FairPlay — Safari nativo', { tag: ['@e2e'] }, () => {

  test.fixme(
    true,
    'FairPlay nativo requiere Safari real en macOS. ' +
    'Playwright WebKit no tiene CDM FairPlay. ' +
    'Habilitar en BrowserStack Tier 2 con macOS + Safari.'
  )

  test('FairPlay HLS: player emite webkitneedkey y completa handshake sin error', async ({ player }) => {
    if (!FAIRPLAY_CONTENT_ID) {
      test.skip(
        true,
        'No hay contenido HLS+FairPlay configurado. ' +
        'Agregar CONTENT_ID_FAIRPLAY_HLS al .env. ' +
        'Requiere Safari real en macOS para funcionar.'
      )
    }

    // Arrange — native.js maneja el flujo FairPlay
    // El player detecta Safari + FairPlay y usa el handler nativo (no hls.js)
    await player.goto({ type: 'media', id: FAIRPLAY_CONTENT_ID!, autoplay: false })
    await player.waitForReady(40_000)

    // Assert — el player debe completar el handshake EME sin error
    await player.assertNoInitError()
  })

  test('FairPlay HLS: player llega a playing en Safari/macOS', async ({ player }) => {
    if (!FAIRPLAY_CONTENT_ID) {
      test.skip(true, 'CONTENT_ID_FAIRPLAY_HLS no configurado — ver .env.example')
    }

    // Arrange
    await player.goto({ type: 'media', id: FAIRPLAY_CONTENT_ID!, autoplay: true })

    // Assert — certificate fetch + license POST completados → video descifrado
    await player.waitForEvent('playing', 45_000)
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })

  test('FairPlay HLS: currentTime avanza confirmando descifrado correcto', async ({ player }) => {
    if (!FAIRPLAY_CONTENT_ID) {
      test.skip(true, 'CONTENT_ID_FAIRPLAY_HLS no configurado — ver .env.example')
    }

    // Arrange
    await player.goto({ type: 'media', id: FAIRPLAY_CONTENT_ID!, autoplay: true })
    await player.waitForEvent('playing', 45_000)

    // Act
    const t1 = await player.getCurrentTime()
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 10_000 }
    ).toBeGreaterThan(t1)
  })
})

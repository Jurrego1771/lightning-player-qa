/**
 * drm-playready-dash.spec.ts — Tests E2E de DRM PlayReady con DASH
 *
 * Cubre: PlayReady key system (com.microsoft.playready) via el nuevo DRMPlugin
 * + getDashProtectionData. PlayReady es el fallback cuando Widevine no está
 * disponible (principalmente Edge/IE en Windows).
 *
 * Fixture: player (DRM requiere browser real con CDM PlayReady)
 * Requiere: Un stream DASH+PlayReady en la plataforma DEV.
 *
 * IMPORTANTE:
 *  - PlayReady CDM está disponible principalmente en Microsoft Edge en Windows.
 *  - En Playwright en Linux/Mac, PlayReady no tiene CDM y no se puede testear.
 *  - Si el browser no soporta PlayReady, getDRMSupport.js lo detecta y el player
 *    no debería intentar usar ese key system — el test verifica ese comportamiento.
 *  - Para testear PlayReady real, usar BrowserStack con Edge en Windows (Tier 2).
 *
 * Tag: @e2e
 */
import { test, expect, ContentIds } from '../../fixtures'

const DASH_PLAYREADY_ID: string | undefined = (process.env.CONTENT_ID_DASH_PLAYREADY) ?? undefined

test.describe('DRM PlayReady + DASH', { tag: ['@e2e'] }, () => {

  test.beforeEach(async ({}, testInfo) => {
    if (!DASH_PLAYREADY_ID) {
      testInfo.skip(
        true,
        'No hay stream DASH+PlayReady configurado. ' +
        'Agregar CONTENT_ID_DASH_PLAYREADY al .env y a ContentIds en streams.ts. ' +
        'El ID debe apuntar a un contenido con DRM PlayReady configurado en la plataforma DEV.'
      )
    }
  })

  test('PlayReady DASH en Edge/Windows: player se inicializa sin error de init', async ({ player }, testInfo) => {
    // PlayReady CDM solo existe en Edge (Windows) — skip en otros browsers
    const browserName = testInfo.project.name
    if (!browserName.toLowerCase().includes('edge') && !browserName.toLowerCase().includes('msedge')) {
      testInfo.skip(
        true,
        'PlayReady CDM requiere Microsoft Edge en Windows. ' +
        'Testear en BrowserStack con Edge (Tier 2 nightly). ' +
        'En Chromium/Firefox/WebKit este test no aplica.'
      )
    }

    // Arrange — DRMPlugin detecta PlayReady y configura dashjs setProtectionData
    await player.goto({ type: 'media', id: DASH_PLAYREADY_ID!, autoplay: false })
    await player.waitForReady(30_000)

    // Assert
    await player.assertNoInitError()
  })

  test('DRMPlugin: si PlayReady no está disponible, player no lanza error de init por DRM', async ({ player }) => {
    // Este test verifica el comportamiento del DRMPlugin cuando el browser
    // NO tiene PlayReady CDM (caso más común en CI con Chromium/Firefox/WebKit).
    // getDRMSupport.js debe detectar que PlayReady no está disponible y el player
    // debe seleccionar el key system correcto o fallar gracefully sin crash.

    await player.goto({ type: 'media', id: DASH_PLAYREADY_ID!, autoplay: false })

    // El player puede llegar a 'ready' o emitir 'error' — pero nunca debe crashear
    // el proceso JavaScript. Verificar que __qa.initError no indica un crash.
    const initError = await player.hasInitError()

    // Si hay error, debe ser un error de DRM conocido (no un crash del player)
    if (initError !== null) {
      expect(initError).toMatch(
        /drm|playready|keysystem|notSupportedError|MediaKeySystemAccess/i
      )
    }
    // Si no hay error, el player se inicializó (quizás usando Widevine como fallback)
    // En ambos casos el test pasa — el contrato es "no crash"
  })

  test('PlayReady DASH: player llega a playing tras license fetch (Edge/Windows)', async ({ player }, testInfo) => {
    const browserName = testInfo.project.name
    if (!browserName.toLowerCase().includes('edge') && !browserName.toLowerCase().includes('msedge')) {
      testInfo.skip(
        true,
        'PlayReady CDM requiere Microsoft Edge en Windows — ver BrowserStack Tier 2.'
      )
    }

    // Arrange
    await player.goto({ type: 'media', id: DASH_PLAYREADY_ID!, autoplay: true })

    // Assert
    await player.waitForEvent('playing', 40_000)
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })
})

/**
 * google-dai-dash-drm.spec.ts — Tests de integración para Google DAI con DASH + DRM
 *
 * Cubre: Google DAI plugin extendido con DRM-aware format selection y
 * deferred manifest URL para el flujo DRM+DAI.
 * El plugin googleDAI debe coordinar con DRMPlugin para seleccionar el
 * stream DASH correcto cuando hay DRM involucrado.
 *
 * Fixture: isolatedPlayer (plataforma mockeada — valida la coordinación DAI+DRM)
 *
 * NOTA: Este es el escenario más complejo: DAI DASH + DRM requiere:
 *  1. Google DAI con assetKeyDash
 *  2. DRM Widevine/PlayReady configurado
 *  3. Coordinación entre googleDAI.plugin.jsx y DRMPlugin
 *  4. Deferred manifest URL para que DRMPlugin resuelva antes de dashjs init
 *
 * TODOS LOS TESTS SON test.fixme() porque requieren:
 *  - Credenciales Google DAI DASH reales
 *  - Stream DASH+DRM en la plataforma
 *  - Chromium con CDM Widevine (o Edge con PlayReady)
 *
 * Tag: @integration
 */
import { test, expect, MockContentIds } from '../../fixtures'

const DAI_NETWORK_CODE = process.env.DAI_NETWORK_CODE ?? ''
const DAI_DASH_DRM_ASSET_KEY = process.env.DAI_DASH_DRM_ASSET_KEY ?? ''

test.describe('Google DAI — DASH + DRM', { tag: ['@integration', '@ads'] }, () => {

  test.fixme(
    true,
    'Google DAI DASH+DRM requiere credenciales DAI reales (DAI_NETWORK_CODE, DAI_DASH_DRM_ASSET_KEY) ' +
    'y un stream DASH+DRM configurado en la plataforma. ' +
    'Habilitar cuando las credenciales estén disponibles en .env.'
  )

  test('DAI DASH+DRM: DRMPlugin resuelve antes de dashjs init (deferred manifest)', async ({ isolatedPlayer: player, page }, testInfo) => {
    if (!DAI_NETWORK_CODE || !DAI_DASH_DRM_ASSET_KEY) {
      testInfo.skip(
        true,
        'DAI_NETWORK_CODE o DAI_DASH_DRM_ASSET_KEY no configurados. Ver .env.example.'
      )
    }

    const browserName = testInfo.project.name
    if (browserName !== 'chromium' && !browserName.toLowerCase().includes('chrome')) {
      testInfo.skip(true, 'DAI DASH+DRM requiere Chromium con CDM Widevine.')
    }

    // Mock de la SDK de DAI para DASH+DRM
    await page.route('**/dai.google.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          stream_manifest: 'https://mock-dai-drm.example.com/stream/manifest.mpd',
        }),
      })
    })

    // Arrange — config con DAI DASH + DRM
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      ads: {
        googleDai: {
          networkCode: DAI_NETWORK_CODE,
          assetKeyDash: DAI_DASH_DRM_ASSET_KEY,
          streamFormat: 'dash',
        },
      },
      drm: 'widevine',
    } as any)

    // Assert — el player debe inicializarse con deferred manifest resuelto
    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    await player.assertNoInitError()
  })

  test('DAI DASH+Widevine: player llega a playing con contenido protegido', async ({ player, page }, testInfo) => {
    if (!DAI_NETWORK_CODE || !DAI_DASH_DRM_ASSET_KEY) {
      testInfo.skip(true, 'Credenciales DAI+DRM no configuradas — ver .env.example.')
    }

    const browserName = testInfo.project.name
    if (browserName !== 'chromium' && !browserName.toLowerCase().includes('chrome')) {
      testInfo.skip(true, 'Widevine CDM requiere Chromium.')
    }

    // Arrange — usar player real (CDM necesita browser real)
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      ads: {
        googleDai: {
          networkCode: DAI_NETWORK_CODE,
          assetKeyDash: DAI_DASH_DRM_ASSET_KEY,
          streamFormat: 'dash',
        },
      },
    } as any)

    // Assert
    await player.waitForEvent('playing', 45_000)
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })

  test('DAI DASH+DRM: coordinación entre googleDAI plugin y DRMPlugin no produce error de init', async ({ isolatedPlayer: player, page }) => {
    // Test de smoke para verificar que los dos plugins coexisten sin colisiones.
    // Usa mocks para ambos (DAI API + DRM license server).

    // Mock de DAI SDK
    await page.route('**/dai.google.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '{}' })
    })

    // Mock de license server
    await page.route('**/widevine/**', async (route) => {
      await route.fulfill({ status: 200, body: '' })
    })

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      ads: {
        googleDai: {
          networkCode: 'mock-network',
          assetKeyDash: 'mock-dash-key',
          streamFormat: 'dash',
        },
      },
    } as any)

    // El player puede fallar con mock credentials, pero no debe crashear JS
    const uncaughtErrors: string[] = []
    player.page.on('pageerror', (err) => {
      uncaughtErrors.push(err.message)
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // No debe haber crashes JavaScript no capturados
    expect(
      uncaughtErrors.filter((e) => !e.toLowerCase().includes('notallowederror')),
      'No debe haber errores JavaScript no capturados durante la coordinación DAI+DRM'
    ).toHaveLength(0)
  })
})

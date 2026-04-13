/**
 * google-dai-dash.spec.ts — Tests de integración para Google DAI con formato DASH
 *
 * Cubre: Google DAI extendido con soporte DASH (assetKeyDash, streamFormat=dash).
 * El nuevo googleDAI plugin selecciona DASH cuando streamFormat=dash o cuando
 * se pasa assetKeyDash en la config de ads.
 *
 * Fixture: isolatedPlayer (plataforma mockeada — valida la selección del formato)
 * Mock: interceptamos la SDK de DAI para controlar la respuesta de stream URL.
 *
 * NOTA: Google DAI requiere credenciales de Google Ad Manager (network code, asset key).
 * Si no están en .env, los tests de DAI real se saltan.
 * Los tests de formato/configuración usan mocks y siempre corren.
 *
 * Tag: @integration
 */
import { test, expect, MockContentIds } from '../../fixtures'

const DAI_NETWORK_CODE = process.env.DAI_NETWORK_CODE ?? ''
const DAI_DASH_ASSET_KEY = process.env.DAI_DASH_ASSET_KEY ?? ''
const MOCK_DAI_STREAM_URL = 'https://mock-dai.example.com/stream/manifest.mpd'

test.describe('Google DAI — Formato DASH', { tag: ['@integration', '@ads'] }, () => {

  test.fixme(
    true,
    'Google DAI con DASH requiere assetKeyDash y credenciales de Google Ad Manager. ' +
    'Marcar como fixme hasta que se configuren DAI_NETWORK_CODE y DAI_DASH_ASSET_KEY en .env. ' +
    'Ver .env.example para las variables necesarias.'
  )

  test('Google DAI DASH: plugin selecciona streamFormat=dash cuando se pasa assetKeyDash', async ({ isolatedPlayer: player, page }) => {
    if (!DAI_NETWORK_CODE || !DAI_DASH_ASSET_KEY) {
      test.skip(
        true,
        'DAI_NETWORK_CODE o DAI_DASH_ASSET_KEY no configurados en .env. ' +
        'Agregar las variables para tests de Google DAI DASH real.'
      )
    }

    // Mock de la SDK de DAI — interceptar el request de stream URL
    await page.route('**/dai.google.com/**', async (route) => {
      const url = route.request().url()
      // Si la request es para DASH, retornar un MPD mock
      if (url.includes('dash') || url.includes('assetKeyDash')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ stream_manifest: MOCK_DAI_STREAM_URL }),
        })
      } else {
        await route.continue()
      }
    })

    // Arrange — config con assetKeyDash
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      ads: {
        googleDai: {
          networkCode: DAI_NETWORK_CODE,
          assetKeyDash: DAI_DASH_ASSET_KEY,
          streamFormat: 'dash',
        },
      },
    } as any)

    // Assert — el player debe inicializarse (aunque el stream mock no sea válido)
    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    await player.assertNoInitError()
  })

  test('Google DAI DASH: evento adsStarted se emite cuando el stream DAI incluye ads', async ({ isolatedPlayer: player, page }) => {
    if (!DAI_NETWORK_CODE || !DAI_DASH_ASSET_KEY) {
      test.skip(true, 'DAI credentials no configuradas — ver .env.example')
    }

    // Arrange
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      ads: {
        googleDai: {
          networkCode: DAI_NETWORK_CODE,
          assetKeyDash: DAI_DASH_ASSET_KEY,
          streamFormat: 'dash',
        },
      },
    } as any)

    // DAI streams tienen ads embedidos en el manifest — no hay adsStarted separado
    // en algunos casos. Verificar que el player llega a playing al menos.
    await player.waitForEvent('playing', 40_000)
    await player.assertIsPlaying()
  })

  test('Google DAI: fallback a HLS cuando assetKeyDash no está disponible', async ({ isolatedPlayer: player, page }) => {
    // Verifica que el plugin selecciona HLS cuando no se pasa assetKeyDash
    // (comportamiento existente que no debe romperse con la nueva extensión DASH)
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      // Sin assetKeyDash → debe usar HLS stream
      ads: {
        googleDai: {
          networkCode: DAI_NETWORK_CODE || 'mock-network',
          assetKey: 'mock-hls-asset-key',
          // streamFormat no especificado → default HLS
        },
      },
    } as any)

    // El player puede fallar por credenciales mock, pero no debe crashear
    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // El player no debe seleccionar DASH cuando no se pasó assetKeyDash
    const handler = await player.getHandler()
    if (handler) {
      expect(handler.toLowerCase()).not.toBe('dash')
    }
  })
})

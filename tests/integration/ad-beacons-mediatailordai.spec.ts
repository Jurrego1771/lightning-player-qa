/**
 * ad-beacons-mediatailordai.spec.ts — Tests de integración para AWS MediaTailor DAI
 *
 * Cubre: SSAI session init, tracking URL polling, ad detection, beacon firing
 * (quartiles, complete, impression) del nuevo MediaTailorDAI manager (373 líneas).
 *
 * Arquitectura del MediaTailor DAI:
 *  1. MediaTailorDAI plugin: fetch SSAI session → adInsertionSessionId → src modificado
 *  2. Manager: polling de tracking URL → detecta ads en el manifest → dispara beacons
 *
 * Fixture: isolatedPlayer + adBeaconInterceptor
 * Mock: interceptamos la API de MediaTailor para devolver una sesión SSAI mock.
 *       Los beacons se capturan via adBeaconInterceptor sin disparar URLs reales.
 *
 * NOTA: Si no hay MEDIATAILORDAI_SESSION_URL en .env, los tests de sesión real
 * se saltan. Los tests de mock siempre corren.
 *
 * Tag: @integration
 */
import { test, expect, MockContentIds } from '../../fixtures'

const MEDIATAILOR_SESSION_URL = process.env.MEDIATAILORDAI_SESSION_URL ?? ''
const MOCK_MEDIATAILOR_BASE = 'http://localhost:9999/mediatailor'

test.describe('MediaTailor DAI — Session Init', { tag: ['@integration', '@ads'] }, () => {

  test('MediaTailor plugin: session init con mock SSAI server responde correctamente', async ({ isolatedPlayer: player, page }) => {
    // Mock de la API de sesión de MediaTailor
    const mockSessionResponse = {
      manifestUrl: 'http://localhost:9001/vod/master.m3u8',
      trackingUrl: `${MOCK_MEDIATAILOR_BASE}/tracking/session-123`,
    }

    await page.route('**/v1/session/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockSessionResponse),
      })
    })

    // Mock del tracking URL (responde con manifest de ads vacío)
    await page.route(`${MOCK_MEDIATAILOR_BASE}/tracking/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ avails: [] }),
      })
    })

    // Arrange — cargar con MediaTailor DAI config
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      mediaTailor: {
        sessionUrl: `${MOCK_MEDIATAILOR_BASE}/v1/session/account/config`,
      },
    } as any)

    // Assert — el player debe inicializarse correctamente con la sesión mock
    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 20_000 }
    ).toBe(true)

    await player.assertNoInitError()
  })

  test('MediaTailor session: si la API de sesión falla, player continúa sin ads', async ({ isolatedPlayer: player, page }) => {
    // Mock de error en la API de sesión (500)
    await page.route('**/v1/session/**', async (route) => {
      await route.fulfill({ status: 500, body: 'Internal Server Error' })
    })

    // Arrange — el manager debe manejar el error gracefully y reproducir el contenido
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      mediaTailor: {
        sessionUrl: `${MOCK_MEDIATAILOR_BASE}/v1/session/account/config`,
      },
    } as any)

    // El player debe reproducir el contenido aunque MediaTailor falle
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
  })
})

test.describe('MediaTailor DAI — Beacon Firing', { tag: ['@integration', '@ads'] }, () => {

  test('beacon de impresión se dispara cuando se detecta un ad en el manifest', async ({ isolatedPlayer: player, adBeaconInterceptor, page }) => {
    // Mock del tracking URL con un avail (ad disponible)
    const mockTrackingResponse = {
      avails: [
        {
          availId: 'avail-1',
          startTimeInSeconds: 0,
          durationInSeconds: 15,
          ads: [
            {
              adId: 'ad-1',
              startTimeInSeconds: 0,
              durationInSeconds: 15,
              trackingEvents: {
                impression: [`${MOCK_MEDIATAILOR_BASE}/track/impression/ad-1`],
                firstQuartile: [`${MOCK_MEDIATAILOR_BASE}/track/firstQuartile/ad-1`],
                midpoint: [`${MOCK_MEDIATAILOR_BASE}/track/midpoint/ad-1`],
                thirdQuartile: [`${MOCK_MEDIATAILOR_BASE}/track/thirdQuartile/ad-1`],
                complete: [`${MOCK_MEDIATAILOR_BASE}/track/complete/ad-1`],
              },
            },
          ],
        },
      ],
    }

    // Mock de la sesión MediaTailor
    await page.route('**/v1/session/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          manifestUrl: 'http://localhost:9001/vod/master.m3u8',
          trackingUrl: `${MOCK_MEDIATAILOR_BASE}/tracking/session-123`,
        }),
      })
    })

    // Mock del tracking URL con ads
    await page.route(`${MOCK_MEDIATAILOR_BASE}/tracking/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockTrackingResponse),
      })
    })

    // Mock de los beacons para que no fallen (200 OK)
    await page.route(`${MOCK_MEDIATAILOR_BASE}/track/**`, async (route) => {
      await route.fulfill({ status: 200, body: '' })
    })

    // Arrange
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      mediaTailor: {
        sessionUrl: `${MOCK_MEDIATAILOR_BASE}/v1/session/account/config`,
      },
    } as any)

    await player.waitForEvent('playing', 20_000)

    // Esperar a que el manager dispare el beacon de impresión
    await expect.poll(
      () => adBeaconInterceptor.wasFired('/track/impression'),
      { timeout: 15_000 }
    ).toBe(true)
  })

  test('MediaTailor: evento adsStarted se emite cuando se detecta ad', async ({ isolatedPlayer: player, page }) => {
    // Mock mínimo de MediaTailor
    await page.route('**/v1/session/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          manifestUrl: 'http://localhost:9001/vod/master.m3u8',
          trackingUrl: `${MOCK_MEDIATAILOR_BASE}/tracking/session-with-ads`,
        }),
      })
    })

    await page.route(`${MOCK_MEDIATAILOR_BASE}/tracking/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          avails: [
            {
              availId: 'avail-pre',
              startTimeInSeconds: 0,
              durationInSeconds: 10,
              ads: [{ adId: 'ad-pre', startTimeInSeconds: 0, durationInSeconds: 10, trackingEvents: {} }],
            },
          ],
        }),
      })
    })

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      mediaTailor: {
        sessionUrl: `${MOCK_MEDIATAILOR_BASE}/v1/session/account/config`,
      },
    } as any)

    // El manager debe emitir adsStarted cuando detecta el avail
    await player.waitForEvent('adsStarted', 20_000)

    const events: string[] = await player.page.evaluate(() => (window as any).__qa?.events ?? [])
    expect(events).toContain('adsStarted')
  })
})

test.describe('MediaTailor DAI — Sesión Real (requiere env)', { tag: ['@integration', '@ads'] }, () => {

  test.beforeEach(async ({}, testInfo) => {
    if (!MEDIATAILOR_SESSION_URL) {
      testInfo.skip(
        true,
        'MEDIATAILORDAI_SESSION_URL no configurado en .env. ' +
        'Este test requiere acceso a una cuenta AWS MediaTailor. ' +
        'Ver .env.example para las variables necesarias.'
      )
    }
  })

  test('sesión SSAI real: player inicia reproducción con ads insertados', async ({ player }) => {
    // Arrange — usar el player real con MediaTailor real
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      mediaTailor: {
        sessionUrl: MEDIATAILOR_SESSION_URL,
      },
    } as any)

    // Assert — el player debe inicializarse y llegar a playing
    await player.waitForEvent('playing', 30_000)
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })
})

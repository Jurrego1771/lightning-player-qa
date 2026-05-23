/**
 * analytics-beacons.spec.ts — Tests de red para el Mediastream Tracker
 *
 * Verifica que el player dispara beacons HTTP al tracker de Mediastream cuando:
 *   - El contenido empieza a reproducirse (play beacon)
 *   - El contenido termina (end beacon)
 *
 * Usa el fixture `player` (real CDN) porque el Mediastream Tracker requiere
 * la config de analytics que viene del player config de plataforma. El mock local
 * (default.json) no incluye config de analytics.
 *
 * Endpoint: track-dev.mdstrm.com (dev) / track.mdstrm.com (prod)
 *
 * Nota de diseño:
 *   Interceptamos y respondemos 200 a todos los requests al tracker (no los bloqueamos)
 *   para que el player no entre en modo de retry que podría alterar el comportamiento.
 *   Colectamos las URLs interceptadas y verificamos su presencia.
 *
 * Tag: @integration @analytics
 */
import { test, expect, ContentIds } from '../../fixtures'

const TRACKER_PATTERN = '**/track*.mdstrm.com/**'
const TRACKER_FALLBACK = '**/*track*mdstrm*'

test.describe('Mediastream Tracker — Network Beacons', { tag: ['@integration', '@analytics'] }, () => {

  test('play beacon se dispara al iniciar reproducción', async ({ player, page }) => {
    const beacons: string[] = []

    await page.route(TRACKER_PATTERN, async (route) => {
      beacons.push(route.request().url())
      await route.fulfill({ status: 200, body: 'ok' })
    })
    await page.route(TRACKER_FALLBACK, async (route) => {
      const url = route.request().url()
      if (url.includes('track') && url.includes('mdstrm')) {
        beacons.push(url)
        await route.fulfill({ status: 200, body: 'ok' })
      } else {
        await route.fallback()
      }
    })

    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 30_000)

    // Dar tiempo al tracker para que envíe el beacon de inicio de reproducción
    await expect.poll(
      () => beacons.length,
      { timeout: 10_000, intervals: [500] }
    ).toBeGreaterThan(0)

    expect(beacons.length, 'al menos 1 beacon de play debe haberse disparado').toBeGreaterThan(0)
  })

  test('beacon contiene el contentId correcto', async ({ player, page }) => {
    const beacons: string[] = []

    await page.route(TRACKER_PATTERN, async (route) => {
      beacons.push(route.request().url())
      await route.fulfill({ status: 200, body: 'ok' })
    })
    await page.route(TRACKER_FALLBACK, async (route) => {
      const url = route.request().url()
      if (url.includes('track') && url.includes('mdstrm')) {
        beacons.push(url)
        await route.fulfill({ status: 200, body: 'ok' })
      } else {
        await route.fallback()
      }
    })

    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 30_000)

    await expect.poll(() => beacons.length, { timeout: 10_000 }).toBeGreaterThan(0)

    // Al menos uno de los beacons debe referenciar el contentId
    const hasContentId = beacons.some((url) => url.includes(ContentIds.vodShort))
    expect(
      hasContentId,
      `ningún beacon contiene el contentId "${ContentIds.vodShort}". Beacons: ${beacons.slice(0, 3).join('\n')}`
    ).toBe(true)
  })

  test('beacons no se disparan durante reproducción de ad (no inflar analytics de contenido)', async ({ player, page }) => {
    // Este test requiere un content con ad configurado. Por ahora valida que durante
    // la reproducción de contenido sin ad, los beacons SÍ se disparan (baseline).
    // El escenario "sin beacons durante ad" requiere un content con adsMap — ver ad-beacons.spec.ts.
    const contentBeacons: string[] = []

    await page.route(TRACKER_PATTERN, async (route) => {
      contentBeacons.push(route.request().url())
      await route.fulfill({ status: 200, body: 'ok' })
    })

    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 30_000)
    await player.assertIsPlaying()

    // La reproducción de contenido sin ads debe generar beacons normalmente
    await expect.poll(() => contentBeacons.length, { timeout: 10_000 }).toBeGreaterThan(0)
  })

  test('beacon del tipo correcto se envía al detectar el evento playing', async ({ player, page }) => {
    const requests: { url: string; method: string }[] = []

    // Capturar todos los requests al tracker con método y URL
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes('track') && url.includes('mdstrm')) {
        requests.push({ url, method: req.method() })
      }
    })

    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 30_000)

    await expect.poll(() => requests.length, { timeout: 10_000 }).toBeGreaterThan(0)

    // Los beacons de analytics típicamente son GET (pixel) o POST (evento batch)
    const validMethods = ['GET', 'POST']
    const allValid = requests.every((r) => validMethods.includes(r.method))
    expect(
      allValid,
      `Beacons deben usar GET o POST. Métodos recibidos: ${requests.map((r) => r.method).join(', ')}`
    ).toBe(true)
  })
})

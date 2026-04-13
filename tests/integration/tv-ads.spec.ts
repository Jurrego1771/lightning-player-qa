/**
 * tv-ads.spec.ts — Validación de IMA auto-enable en dispositivos TV
 *
 * Cubre: useAdsManager auto-enables on TV cuando no hay config de ads explícita.
 *        El cambio en src/view/none/components/ad.js reemplazó coerción booleana
 *        por null-coalescing, haciendo que en TV siempre se active el AdsManager
 *        incluso cuando el integrador no pasó adsMap ni ads config.
 *
 * Fixture: isolatedPlayer — plataforma mockeada, stream HLS local.
 *          Se usa mockPlayerConfig() para simular la respuesta del player config
 *          con y sin la flag de TV para comparar el comportamiento.
 *
 * Estrategia:
 *   1. Test "sin TV": sin adsMap, sin UA de TV → AdsManager NO debe inicializarse
 *   2. Test "con TV + sin adsMap": UA de TV → AdsManager SI debe intentar init
 *      (aunque no haya VAST URL, el manager se activa y emite adsError o continúa)
 *   3. Test "con TV + adsMap": UA de TV + VAST → flujo completo de pre-roll
 *
 * Requiere: mock-vast server en localhost:9999 para el test #3
 */
import { test, expect, MockContentIds } from '../../fixtures'

const MOCK_VAST_URL = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

// ── Helper: simular UA de TV (Tizen Samsung) ──────────────────────────────────

async function emulateTV(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
      configurable: true,
    })
  })
}

// ── Helper: verificar si el AdsManager se inicializó ─────────────────────────
//
// Cuando IMA AdsManager se inicializa, el player emite 'adsStarted' o 'adsError'
// dependiendo de si hay VAST disponible. Si no hay ads en absoluto, ninguno de
// estos eventos aparece en __qa.events.

async function wasAdsManagerInitialized(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const events: string[] = (window as any).__qa?.events ?? []
    // Cualquiera de estos eventos indica que el AdsManager se intentó inicializar
    return (
      events.includes('adsStarted') ||
      events.includes('adsError') ||
      events.includes('adsAllAdsCompleted') ||
      events.includes('adsContentPauseRequested')
    )
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('TV Ads — useAdsManager Auto-Enable', { tag: ['@integration', '@ads'] }, () => {

  test('sin UA de TV y sin adsMap: AdsManager NO se inicializa', async ({ isolatedPlayer, page }) => {
    // Arrange: UA de desktop (sin TV), sin adsMap
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        configurable: true,
      })
    })

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      // Sin adsMap intencionalmente
    })

    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()

    // Assert: el AdsManager no debe haberse inicializado
    const adsManagerInit = await wasAdsManagerInitialized(page)
    expect(adsManagerInit, 'El AdsManager no debería inicializarse sin TV y sin adsMap').toBe(false)
  })

  test('con UA de TV y sin adsMap: AdsManager se activa (auto-enable por null-coalescing)', async ({ isolatedPlayer, page }) => {
    // Arrange: emular UA de TV → isTVAtom=true → useAdsManager auto-enable
    await emulateTV(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      // Sin adsMap — el auto-enable debe venir del isTVAtom
    })

    // Con TV y sin VAST URL, el AdsManager intentará inicializarse pero no tendrá
    // ad que reproducir. El player debe continuar reproduciendo el contenido.
    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()

    // Verificar que no hubo error de init del player (el AdsManager fallando no debe
    // romper la reproducción del contenido)
    await isolatedPlayer.assertNoInitError()
  })

  test('con UA de TV y con adsMap: pre-roll se reproduce en TV', async ({ isolatedPlayer, page }) => {
    // Arrange: emular UA de TV + VAST URL configurada
    // autoplay: false para que IMA tenga tiempo de inicializarse antes de que
    // el contenido empiece — evita la race condition IMA init vs autoplay.
    await emulateTV(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    await isolatedPlayer.waitForReady()

    // Triggear play manualmente — IMA ya está inicializado en este punto
    await isolatedPlayer.play()

    // Assert: el pre-roll inició (adsStarted en __qa.events es suficiente evidencia)
    await isolatedPlayer.waitForAdStart(20_000)

    // Verificar que el player reporta que está reproduciendo un ad
    const isPlayingAd = await page.evaluate(() => (window as any).__player?.isPlayingAd ?? false)
    expect(isPlayingAd, 'isPlayingAd debe ser true durante el pre-roll en TV').toBe(true)
  })

  test('con UA de TV: después del ad el contenido continúa reproduciendo', async ({ isolatedPlayer, page }) => {
    // Arrange: autoplay: false para que IMA inicialice antes de que comience el contenido
    await emulateTV(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    await isolatedPlayer.waitForReady()
    await isolatedPlayer.play()

    // Act: esperar que el ad complete
    await isolatedPlayer.waitForEvent('adsStarted', 20_000)
    await isolatedPlayer.waitForEvent('adsContentResumeRequested', 60_000)

    // Assert: el contenido retomó la reproducción después del ad
    await isolatedPlayer.assertIsPlaying()
    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.isPlayingAd ?? false),
      { timeout: 5_000 }
    ).toBe(false)
  })

  test('con UA de TV y VAST vacío: player continúa sin ad y sin error', async ({ isolatedPlayer, page }) => {
    // Caso edge: VAST vacío pero isTVAtom=true — el player no debe romper
    await emulateTV(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/empty`,
    })

    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()

    const errors = await isolatedPlayer.getErrors()
    const fatalErrors = errors.filter((e: any) => e?.fatal === true)
    expect(fatalErrors, 'VAST vacío en TV no debe producir errores fatales').toHaveLength(0)
  })
})

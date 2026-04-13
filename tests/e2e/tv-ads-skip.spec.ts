/**
 * tv-ads-skip.spec.ts — Validación del skip button con auto-focus en TV
 *
 * Cubre: Skip-ad button gets TV focus management en src/view/video/components/ads/adsSkin.jsx
 *        - El botón de skip recibe focus automáticamente cuando el skip se habilita
 *        - El botón tiene el id FOCUS_IDS.SKIP_AD para navegación D-pad
 *        - El skip funciona via teclado (Enter/Space) en TV
 *        - Después del skip el contenido retoma reproducción
 *
 * Fixture: player (IMA SDK + VAST real requieren red real para ads en E2E)
 *
 * Requiere: ContentIds.vodWithAds (contenido con skippable ad configurado en plataforma)
 *           Si el contenido no tiene ad skippable, el test se marca skip condicionalmente.
 */
import { test, expect, ContentIds } from '../../fixtures'

// ── Helper: emular UA de TV ────────────────────────────────────────────────────

async function emulateTV(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
      configurable: true,
    })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('TV Ads — Skip Button Auto-Focus', { tag: ['@e2e'] }, () => {

  test('skip button recibe focus automático cuando el ad se vuelve skippable en TV', async ({ player, page }) => {
    // Arrange: emular UA de TV para activar el TV skin y el focus management
    await emulateTV(page)

    await player.goto({
      type: 'media',
      id: ContentIds.vodWithAds,
      autoplay: true,
    })

    // Esperar inicio del ad
    await player.waitForAdStart(20_000)

    // Esperar a que el skipoffset expire y el botón de skip aparezca
    await player.waitForEvent('adsSkippableStateChanged', 30_000)

    const skippable = await player.isAdSkippable()
    if (!skippable) {
      test.skip(true, 'El ad actual no tiene skipoffset — verificar ContentIds.vodWithAds')
      return
    }

    // Assert: el skip button debe tener focus automático (auto-focus en TV skin)
    // El botón tiene el id "skip-ad" o aria-label="Skip Ad" según el FOCUS_IDS del player
    const skipButton = page.locator('[aria-label="Skip Ad"], [aria-label="Saltar anuncio"], [id="skip-ad"]').first()
    await expect(skipButton).toBeVisible({ timeout: 5_000 })

    // Verificar que el botón tiene focus activo
    await expect.poll(
      async () => {
        return page.evaluate(() => {
          const focused = document.activeElement
          if (!focused) return false
          const ariaLabel = focused.getAttribute('aria-label') ?? ''
          const id = focused.id ?? ''
          return (
            ariaLabel.toLowerCase().includes('skip') ||
            id.toLowerCase().includes('skip')
          )
        })
      },
      { timeout: 5_000, message: 'El skip button no recibió focus automático en TV' }
    ).toBe(true)
  })

  test('skip button responde a Enter (confirm key de TV remote) en TV', async ({ player, page }) => {
    // Arrange
    await emulateTV(page)

    await player.goto({
      type: 'media',
      id: ContentIds.vodWithAds,
      autoplay: true,
    })

    await player.waitForAdStart(20_000)
    await player.waitForEvent('adsSkippableStateChanged', 30_000)

    const skippable = await player.isAdSkippable()
    if (!skippable) {
      test.skip(true, 'El ad actual no tiene skipoffset — verificar ContentIds.vodWithAds')
      return
    }

    // Act: presionar Enter en el skip button (TV remote confirm key)
    // En TV, el skip button tiene auto-focus, por lo que Enter debe disparar el skip
    await page.keyboard.press('Enter')

    // Assert: el ad fue skipeado
    await player.waitForEvent('adsSkipped', 5_000)
    await player.waitForEvent('adsContentResumeRequested', 10_000)
    await player.assertIsPlaying()

    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.isPlayingAd?.() ?? false),
      { timeout: 5_000 }
    ).toBe(false)
  })

  test('después del skip el contenido retoma y el tiempo avanza correctamente', async ({ player, page }) => {
    // Arrange
    await emulateTV(page)

    await player.goto({
      type: 'media',
      id: ContentIds.vodWithAds,
      autoplay: true,
    })

    await player.waitForAdStart(20_000)
    await player.waitForEvent('adsSkippableStateChanged', 30_000)

    const skippable = await player.isAdSkippable()
    if (!skippable) {
      test.skip(true, 'El ad actual no tiene skipoffset — verificar ContentIds.vodWithAds')
      return
    }

    // Act: skipear el ad via API (equivalente al botón en TV)
    await player.skipAd()
    await player.waitForEvent('adsContentResumeRequested', 10_000)

    // Assert: el contenido está reproduciendo y el tiempo avanza
    await player.assertIsPlaying()

    const t1 = await player.getCurrentTime()
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 8_000, message: 'El currentTime no avanzó después del skip del ad' }
    ).toBeGreaterThan(t1)
  })

  test('sin UA de TV: skip button no tiene auto-focus (comportamiento desktop)', async ({ player, page }) => {
    // Verificar que el comportamiento de auto-focus es EXCLUSIVO del TV skin.
    // En desktop, el skip button es visible pero no recibe focus automáticamente.

    // Sin emulateTV() — UA de desktop normal
    await player.goto({
      type: 'media',
      id: ContentIds.vodWithAds,
      autoplay: true,
    })

    await player.waitForAdStart(20_000)
    await player.waitForEvent('adsSkippableStateChanged', 30_000)

    const skippable = await player.isAdSkippable()
    if (!skippable) {
      test.skip(true, 'El ad actual no tiene skipoffset — verificar ContentIds.vodWithAds')
      return
    }

    // En desktop el skip button es visible pero el focus activo NO debe ser el skip button
    // (el focus management automático es solo del TV skin)
    const skipButtonHasFocus = await page.evaluate(() => {
      const focused = document.activeElement
      if (!focused || focused === document.body) return false
      const ariaLabel = focused.getAttribute('aria-label') ?? ''
      const id = focused.id ?? ''
      return ariaLabel.toLowerCase().includes('skip') || id.toLowerCase().includes('skip')
    })

    // En desktop no esperamos auto-focus en el skip button
    expect(
      skipButtonHasFocus,
      'En desktop el skip button no debería recibir focus automático (solo TV skin lo hace)'
    ).toBe(false)
  })
})

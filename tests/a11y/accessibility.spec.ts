/**
 * accessibility.spec.ts — Tests de Accesibilidad (WCAG 2.1 AA)
 *
 * Usa axe-core para detectar violaciones automáticas (~57% de issues WCAG).
 * Los checks manuales (screen reader, zoom) se documentan como TODO para revisión manual.
 *
 * Usa `isolatedPlayer` con plataforma mockeada + streams HLS locales para que
 * el estado del player sea predecible y los tests no dependan de CDN ni plataforma.
 *
 * Target: WCAG 2.1 AA compliance en todos los tipos de player.
 */
import { test, expect, MockContentIds } from '../../fixtures'
import AxeBuilder from '@axe-core/playwright'

test.describe('Accessibility — Player de Video', { tag: ['@a11y'] }, () => {

  test('no hay violaciones WCAG en estado idle', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })

  test('no hay violaciones WCAG durante la reproducción', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })

  test('controles del player son navegables con Tab', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    // Tab debe moverse entre elementos interactivos sin quedar atrapado
    await page.keyboard.press('Tab')
    const firstFocused = await page.evaluate(() => document.activeElement?.tagName)
    expect(firstFocused).toBeTruthy()

    await page.keyboard.press('Tab')
    const secondFocused = await page.evaluate(() => document.activeElement?.tagName)
    expect(secondFocused).toBeTruthy()
  })

  test('Space/Enter activan play en el botón de play', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()
    await player.waitForCanPlay()

    // Encontrar y hacer focus en el botón de play
    const playButton = page.locator('[aria-label*="play" i], [aria-label*="Play" i], button[class*="play"]').first()
    await playButton.focus()
    await page.keyboard.press('Space')

    await player.assertIsPlaying()
  })

  test('todos los botones de control tienen aria-label', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    // Buscar botones sin aria-label ni aria-labelledby
    const buttonsWithoutLabel = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      return buttons
        .filter(b => !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby') && !b.textContent?.trim())
        .map(b => b.outerHTML.slice(0, 100))
    })

    expect(buttonsWithoutLabel).toHaveLength(0)
  })

  test('slider de volumen tiene role="slider" con aria-valuenow', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    const volumeSlider = page.locator('[role="slider"][aria-label*="volume" i], [role="slider"][aria-label*="volumen" i]')
    if (await volumeSlider.count() > 0) {
      await expect(volumeSlider.first()).toHaveAttribute('aria-valuenow')
      await expect(volumeSlider.first()).toHaveAttribute('aria-valuemin')
      await expect(volumeSlider.first()).toHaveAttribute('aria-valuemax')
    }
  })
})

test.describe('Accessibility — Player de Audio', { tag: ['@a11y'] }, () => {
  test('no hay violaciones WCAG en player de audio', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.audio, autoplay: false, view: 'compact' })
    await player.waitForReady()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })
})

/*
 * ── Tests Manuales Documentados ───────────────────────────────────────────
 * Los siguientes items requieren verificación manual con screen reader:
 *
 * [ ] NVDA + Chrome: "Video player, Play button" al hacer focus en play
 * [ ] VoiceOver + Safari: ídem en macOS
 * [ ] Zoom 400%: controles no se superponen
 * [ ] High contrast mode: controles siguen siendo visibles
 * [ ] Sin mouse: flujo completo de play, seek, pause, fullscreen con solo teclado
 */

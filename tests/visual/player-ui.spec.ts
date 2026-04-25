/**
 * player-ui.spec.ts — Visual Regression Tests
 *
 * Captura screenshots del player en estados clave y los compara contra baseline.
 *
 * WORKFLOW:
 *   Primera vez (crear baseline):    npm run test:update-snapshots
 *   Runs subsiguientes (comparar):   npm run test:visual
 *
 * Los screenshots se guardan en tests/visual/__snapshots__/
 * Commitear el baseline al repositorio para que CI pueda comparar.
 *
 * Usa `isolatedPlayer` con plataforma mockeada + streams HLS locales para que
 * los screenshots sean deterministas: mismo frame, mismo color, sin variaciones de CDN.
 */
import { test, expect, MockContentIds } from '../../fixtures'
import { mockContentError } from '../../fixtures/platform-mock'

// Deshabilitar animaciones CSS para screenshots estables
const disableAnimations = async (page: import('@playwright/test').Page) => {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  })
}

test.describe('Visual Regression — Player de Video', { tag: ['@visual'] }, () => {

  test('estado idle — sin poster', async ({ isolatedPlayer: player, page }) => {
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await player.waitForReady()
    await disableAnimations(page)

    await expect(page).toHaveScreenshot('video-idle.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('controles visibles — hover', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForCanPlay()
    await disableAnimations(page)

    // Mover mouse sobre el player para mostrar controles.
    // El harness usa id="player-container" — no hay data-testid ni clase .msp-player.
    await page.locator('#player-container').hover()

    await expect(page).toHaveScreenshot('video-controls-visible.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('estado de error — plataforma devuelve 403', async ({ isolatedPlayer: player, page }) => {
    // setupPlatformMocks ya corrió (vía isolatedPlayer fixture).
    // mockContentError registra un handler adicional que Playwright evalúa primero (LIFO).
    // Para contenido: devuelve 403. Para player config: route.continue() → siguiente
    // handler (setupPlatformMocks) → devuelve player config correctamente.
    await mockContentError(page, 403)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('error', 15_000)
    await disableAnimations(page)

    await expect(page).toHaveScreenshot('video-error-state.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('player en mobile viewport (375px)', async ({ isolatedPlayer: player, page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()
    await disableAnimations(page)

    await expect(page).toHaveScreenshot('video-mobile-375.png', {
      maxDiffPixelRatio: 0.03, // tolerancia mayor en mobile
    })
  })
})

test.describe('Visual Regression — Player de Audio', { tag: ['@visual'] }, () => {
  test('audio player — estado idle', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.audio, autoplay: false, view: 'compact' })
    await player.waitForReady()
    await disableAnimations(page)

    await expect(page).toHaveScreenshot('audio-idle.png', {
      maxDiffPixelRatio: 0.02,
    })
  })
})

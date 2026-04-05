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
 * IMPORTANTE: Freeze el video antes de capturar para screenshots estables.
 */
import { test, expect, Streams } from '../../fixtures'

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

test.describe('Visual Regression — Player de Video', () => {

  test('estado idle — solo poster', async ({ player, page }) => {
    await player.goto({
      type: 'media',
      src: Streams.hls.vodShort,
      autoplay: false,
      poster: 'https://via.placeholder.com/1280x720/000000/FFFFFF?text=QA+Test+Poster',
    })
    await player.waitForReady()
    await disableAnimations(page)

    await expect(page).toHaveScreenshot('video-idle.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('controles visibles — hover', async ({ player, page }) => {
    await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: true })
    await player.waitForCanPlay()
    await disableAnimations(page)

    // Mover mouse sobre el player para mostrar controles
    const playerEl = page.locator('[data-testid="player"], .msp-player, #player').first()
    await playerEl.hover()

    await expect(page).toHaveScreenshot('video-controls-visible.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('estado de error', async ({ player, page }) => {
    await player.goto({
      type: 'media',
      src: 'https://invalid.example.com/nonexistent.m3u8', // fuente inválida
      autoplay: true,
    })
    await player.waitForEvent('error', 15_000)
    await disableAnimations(page)

    await expect(page).toHaveScreenshot('video-error-state.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('player en mobile viewport (375px)', async ({ player, page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: false })
    await player.waitForReady()
    await disableAnimations(page)

    await expect(page).toHaveScreenshot('video-mobile-375.png', {
      maxDiffPixelRatio: 0.03, // tolerancia mayor en mobile
    })
  })
})

test.describe('Visual Regression — Player de Audio', () => {
  test('audio player — estado idle', async ({ player, page }) => {
    await player.goto({ type: 'audio', src: Streams.audio.mp3, autoplay: false, view: 'audio' })
    await player.waitForReady()
    await disableAnimations(page)

    await expect(page).toHaveScreenshot('audio-idle.png', {
      maxDiffPixelRatio: 0.02,
    })
  })
})

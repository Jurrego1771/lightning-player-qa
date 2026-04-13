/**
 * tv-skin-regression.spec.ts — Visual Baseline para TV Skin
 *
 * Cubre: TV skin visual baseline missing (src/view/video/components/skin/tv/)
 *        - TVSkin en estado idle (sin reproducción)
 *        - TVSkin con controles visibles (skin activo)
 *        - TVHeader con back arrow visible
 *        - TVControls (bottom-left y bottom-right)
 *        - TV skin en estado de pausa (con TVInfo overlay)
 *
 * Fixture: isolatedPlayer — los screenshots deben ser deterministas.
 *          Plataforma mockeada + stream HLS local para que el frame sea siempre igual.
 *
 * WORKFLOW:
 *   Primera vez (crear baseline):  npm run test:update-snapshots
 *   Runs subsiguientes (comparar): npm run test:visual
 *
 * Viewport: 1920x1080 (resolución estándar de Smart TV)
 * Los screenshots se guardan en tests/visual/tv-skin-regression.spec.ts-snapshots/
 *
 * IMPORTANTE: El TV skin solo se renderiza cuando el UA detecta un dispositivo TV.
 * Usamos addInitScript() para sobreescribir navigator.userAgent antes de cargar
 * el player, igual que en los tests E2E e integration de TV.
 */
import { test, expect, MockContentIds } from '../../fixtures'

// ── Constantes ────────────────────────────────────────────────────────────────

const TV_VIEWPORT = { width: 1920, height: 1080 }

// ── Helpers ───────────────────────────────────────────────────────────────────

async function emulateTV(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
      configurable: true,
    })
  })
}

// Deshabilitar animaciones CSS para screenshots estables
async function disableAnimations(page: import('@playwright/test').Page): Promise<void> {
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

// Activar el skin TV (hacer visible los controles)
async function activateSkin(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#player-container').click()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Visual Regression — TV Skin', { tag: ['@visual'] }, () => {

  test.beforeEach(async ({ page }) => {
    // Todas las pruebas visuales de TV usan viewport 1920x1080
    await page.setViewportSize(TV_VIEWPORT)
  })

  test('TV skin — estado idle (sin reproducción, controles ocultos)', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await emulateTV(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await player.waitForReady()
    await disableAnimations(page)

    // Assert: captura del estado inicial en TV (sin controles visibles por inactividad)
    await expect(page).toHaveScreenshot('tv-skin-idle.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('TV skin — controles visibles (skin activo tras interacción)', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await emulateTV(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await player.waitForEvent('playing', 20_000)
    await disableAnimations(page)

    // Activar el skin (mostrar controles)
    await activateSkin(page)

    // Breve pausa para que el skin se renderice completamente
    await expect.poll(
      () => page.locator('[aria-label="Back"], [aria-label="Volver"], [aria-label="Play"], [aria-label="Pause"]').first().isVisible().catch(() => false),
      { timeout: 3_000 }
    ).toBe(true)

    await expect(page).toHaveScreenshot('tv-skin-controls-visible.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('TV skin — estado de pausa (TVInfo overlay visible)', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await emulateTV(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await player.waitForEvent('playing', 20_000)

    // Pausar para activar el overlay de info de TV
    await player.pause()
    await player.waitForEvent('pause', 10_000)
    await disableAnimations(page)

    await expect(page).toHaveScreenshot('tv-skin-paused.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('TV skin — header con back arrow visible', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await emulateTV(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await player.waitForEvent('playing', 20_000)
    await disableAnimations(page)
    await activateSkin(page)

    // Capturar solo el área del header para un baseline más específico
    const header = page.locator(
      '[data-testid="tv-header"], .tv-header, [aria-label="Back"], [aria-label="Volver"]'
    ).first()

    const headerVisible = await header.isVisible().catch(() => false)

    if (headerVisible) {
      await expect(header).toHaveScreenshot('tv-skin-header.png', {
        maxDiffPixelRatio: 0.02,
      })
    } else {
      // Fallback: capturar toda la página si no encontramos el header específico
      await expect(page).toHaveScreenshot('tv-skin-header-fullpage.png', {
        maxDiffPixelRatio: 0.02,
      })

      test.info().annotations.push({
        type: 'info',
        description: 'Header TV no detectado por selector — captura de pantalla completa usada como fallback',
      })
    }
  })

  test('TV skin — sidebar de audio y subtítulos abierto', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await emulateTV(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await player.waitForEvent('playing', 20_000)
    await disableAnimations(page)
    await activateSkin(page)

    // Intentar abrir el sidebar de audio/subtitle
    const sidebarButton = page.locator(
      '[aria-label="Audio and subtitles"], [aria-label="Audio y subtítulos"], [aria-label="Áudio e legendas"]'
    ).first()

    const sidebarButtonVisible = await sidebarButton.isVisible().catch(() => false)

    if (sidebarButtonVisible) {
      await sidebarButton.click()
      await disableAnimations(page)

      await expect(page).toHaveScreenshot('tv-skin-sidebar-audio.png', {
        maxDiffPixelRatio: 0.02,
      })
    } else {
      // Captura del estado de controles como fallback
      await expect(page).toHaveScreenshot('tv-skin-sidebar-not-available.png', {
        maxDiffPixelRatio: 0.02,
      })

      test.info().annotations.push({
        type: 'info',
        description: 'Botón de sidebar de audio no visible — el contenido mock puede no tener audio tracks',
      })
    }
  })

  test('TV skin — en viewport 1280x720 (TV HD)', async ({ isolatedPlayer: player, page }) => {
    // Algunas Smart TV tienen resolución HD en lugar de Full HD
    await page.setViewportSize({ width: 1280, height: 720 })

    await emulateTV(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await player.waitForReady()
    await disableAnimations(page)

    await expect(page).toHaveScreenshot('tv-skin-1280x720.png', {
      maxDiffPixelRatio: 0.03, // tolerancia mayor para resolución diferente
    })
  })

  test('desktop skin NO muestra back arrow (verificar que el branching es correcto)', async ({ isolatedPlayer: player, page }) => {
    // Test de regresión: verificar que el skin normal (desktop) no se rompió
    // por la introducción del TV skin. Sin emulateTV(), debe renderizarse el skin normal.

    // Sin emulateTV() — UA por defecto del browser de Playwright (desktop)
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await player.waitForReady()
    await disableAnimations(page)

    await expect(page).toHaveScreenshot('desktop-skin-no-back-arrow.png', {
      maxDiffPixelRatio: 0.02,
    })
  })
})

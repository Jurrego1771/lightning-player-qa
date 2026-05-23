/**
 * pause-ad-flow.spec.ts — Tests E2E del flujo completo de Pause Ads
 *
 * Cubre el flujo visual completo: play → pause → overlay aparece → interacciones
 * con el overlay → overlay desaparece al reanudar.
 *
 * Estrategia: usar `isolatedPlayer` con content config que incluye ads.pausead.tag
 * apuntando al mock-vast server. Así el flujo E2E es determinista sin depender de
 * contenido real de producción con pauseAd configurado.
 *
 * El overlay de pause-ad se observable via:
 *   - Presencia del elemento .pause-ad__asset (imagen del ad)
 *   - Botón "Close" con aria-label="Close" para el botón X
 *   - Botón "View More" (clase .pause-ad__more-info)
 *
 * Anti-patrones evitados:
 *   - Sin waitForTimeout para "esperar la animación" — solo expect.poll() y locator assertions
 *   - Sin acceder a clases CSS internas para estado — solo presencia/ausencia del elemento
 *   - Sin asumir duración exacta de timers — usar expect.poll con timeout generoso
 */
import { test, expect, MockContentIds, mockContentConfig } from '../../fixtures'

const MOCK_VAST_URL = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

// ── Config helper ─────────────────────────────────────────────────────────────

async function enablePauseAd(
  page: import('@playwright/test').Page,
  options: {
    tagUrl?: string
    duration?: number
    closeButton?: number
    position?: string
  } = {}
): Promise<void> {
  const {
    tagUrl = `${MOCK_VAST_URL}/vast/pausead`,
    duration = 0,
    closeButton = -1,
    position = 'center',
  } = options

  await mockContentConfig(page, {
    ads: {
      pausead: {
        tag: tagUrl,
        tagMobile: tagUrl,
        duration,
        closeButton,
        position,
      },
    },
  })
}

// ── Flujo principal ───────────────────────────────────────────────────────────

test.describe('Pause Ad Flow — Overlay aparece y desaparece', { tag: ['@e2e', '@ads'] }, () => {

  test('play → pause → overlay aparece con imagen del ad', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await enablePauseAd(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Act
    await player.pause()
    await player.waitForEvent('pause', 10_000)

    // Assert — el overlay con la imagen del pause ad se renderiza
    await expect.poll(
      () => page.locator('.pause-ad__asset').count(),
      { timeout: 10_000 }
    ).toBeGreaterThanOrEqual(1)

    await expect(page.locator('.pause-ad__asset').first()).toBeVisible()
  })

  test('overlay desaparece cuando se hace play', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await enablePauseAd(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Pausar para mostrar el overlay
    await player.pause()
    await player.waitForEvent('pause', 10_000)

    // Esperar que el overlay sea visible
    await expect.poll(
      () => page.locator('.pause-ad__asset').count(),
      { timeout: 10_000 }
    ).toBeGreaterThanOrEqual(1)

    // Act — reanudar reproducción
    await player.play()
    await player.assertIsPlaying()

    // Assert — el overlay desaparece (la animación de salida dura 500ms)
    await expect.poll(
      () => page.locator('.pause-ad__asset').count(),
      { timeout: 5_000 }
    ).toBe(0)
  })

  test('click en botón X (close) oculta el overlay y reanuda la reproducción', async ({ isolatedPlayer: player, page }) => {
    // Arrange — closeButton=-1 muestra el botón X inmediatamente
    await enablePauseAd(page, { closeButton: -1 })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Pausar para mostrar el overlay
    await player.pause()
    await player.waitForEvent('pause', 10_000)

    // Esperar que el botón Close aparezca
    await expect.poll(
      () => page.locator('button.pause-ad__close-x').count(),
      { timeout: 10_000 }
    ).toBeGreaterThanOrEqual(1)

    // Act — click en el botón X
    await page.locator('button.pause-ad__close-x').first().click()

    // Assert — el overlay desaparece y el player retoma reproducción
    await expect.poll(
      () => page.locator('.pause-ad__asset').count(),
      { timeout: 5_000 }
    ).toBe(0)

    await player.assertIsPlaying()
  })

  test('ciclo pause/play múltiple — overlay aparece y desaparece correctamente en cada ciclo', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await enablePauseAd(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Ciclo 1
    await player.pause()
    await player.waitForEvent('pause', 10_000)
    await expect.poll(
      () => page.locator('.pause-ad__asset').count(),
      { timeout: 10_000 }
    ).toBeGreaterThanOrEqual(1)

    await player.play()
    await player.assertIsPlaying()
    await expect.poll(
      () => page.locator('.pause-ad__asset').count(),
      { timeout: 5_000 }
    ).toBe(0)

    // Ciclo 2 — el overlay debe volver a aparecer correctamente
    await player.pause()
    await player.waitForEvent('pause', 10_000)
    await expect.poll(
      () => page.locator('.pause-ad__asset').count(),
      { timeout: 10_000 }
    ).toBeGreaterThanOrEqual(1)

    // Ciclo 2 → play
    await player.play()
    await player.assertIsPlaying()
    await expect.poll(
      () => page.locator('.pause-ad__asset').count(),
      { timeout: 5_000 }
    ).toBe(0)
  })

})

// ── Interacción durante linear ad ─────────────────────────────────────────────

test.describe('Pause Ad Flow — No aparece durante linear ad activo', { tag: ['@e2e', '@ads'] }, () => {

  test('player pausado durante pre-roll lineal no muestra overlay de pauseAd', async ({ isolatedPlayer: player, page }) => {
    // Arrange — habilitar tanto pauseAd como un pre-roll lineal
    // El state machine en pauseAd.js verifica isAdsPlayingAtom antes de mostrar el overlay
    await mockContentConfig(page, {
      ads: {
        pausead: {
          tag: `${MOCK_VAST_URL}/vast/pausead`,
          tagMobile: `${MOCK_VAST_URL}/vast/pausead`,
          closeButton: -1,
        },
      },
    })

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    // Esperar que el pre-roll arranque
    await player.waitForAdStart(20_000)

    // Act — pausar MIENTRAS el linear ad está activo
    await player.pause()
    await player.waitForEvent('pause', 10_000)

    // Assert — el overlay de pause-ad NO debe aparecer mientras hay un ad lineal activo
    // (pauseAdShowAtom = started && !isAdsPlaying — durante el ad, isAdsPlaying=true)
    await page.waitForTimeout(2_000)
    const overlayCount = await page.locator('.pause-ad__asset').count()
    expect(overlayCount, 'El overlay de pause-ad no debe mostrarse durante un linear ad').toBe(0)
  })

})

// ── Textos i18n ───────────────────────────────────────────────────────────────

test.describe('Pause Ad Flow — Textos del overlay', { tag: ['@e2e', '@ads'] }, () => {

  test('botón Close Ad muestra texto por defecto cuando no hay closeText en la config', async ({ isolatedPlayer: player, page }) => {
    // Arrange — config sin messages.closeText, se usará el fallback del i18n
    await mockContentConfig(page, {
      ads: {
        pausead: {
          tag: `${MOCK_VAST_URL}/vast/pausead`,
          tagMobile: `${MOCK_VAST_URL}/vast/pausead`,
          closeButton: -1,
          duration: 0,
        },
      },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Act
    await player.pause()
    await player.waitForEvent('pause', 10_000)

    // Assert — el texto de cierre muestra el fallback del i18n ("Close Ad" en inglés)
    await expect.poll(
      () => page.locator('.pause-ad__close-text').count(),
      { timeout: 10_000 }
    ).toBeGreaterThanOrEqual(1)

    const closeText = await page.locator('.pause-ad__close-text').first().textContent()
    expect(closeText?.trim()).toBeTruthy()
    // El texto debe ser alguno de los valores i18n conocidos (en/es/pt)
    expect(['Close Ad', 'Cerrar anuncio', 'Fechar anúncio']).toContain(closeText?.trim())
  })

  test('botón View More muestra texto por defecto cuando no hay viewMoreText en la config', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await enablePauseAd(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Act
    await player.pause()
    await player.waitForEvent('pause', 10_000)

    // Assert — el botón View More tiene el texto i18n por defecto
    await expect.poll(
      () => page.locator('button.pause-ad__more-info').count(),
      { timeout: 10_000 }
    ).toBeGreaterThanOrEqual(1)

    const viewMoreText = await page.locator('button.pause-ad__more-info').first().textContent()
    expect(viewMoreText?.trim()).toBeTruthy()
    expect(['View More', 'Ver más', 'Ver mais']).toContain(viewMoreText?.trim())
  })

})

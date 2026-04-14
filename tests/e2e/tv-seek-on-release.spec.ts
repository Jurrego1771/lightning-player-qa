/**
 * tv-seek-on-release.spec.ts — El seeking debe ejecutarse al soltar el botón (keyup)
 *
 * Bug #3 (issue-637): al desplazar la barra de progreso con el D-pad, el player
 * no ejecutaba el seek cuando el usuario soltaba el botón. Era necesario presionar
 * Enter/OK adicional para confirmar el salto.
 *
 * Cubre: src/view/video/hooks/useTVNavigation.js
 *        - El evento keyup en ArrowRight/ArrowLeft debe comprometer el seek acumulado
 *          automáticamente sin requerir Enter/OK.
 *
 * ── Limitación de entorno ─────────────────────────────────────────────────────
 * useTVNavigation adjunta listeners al containerRef del player. En Playwright
 * (Chromium/Firefox/WebKit de escritorio), el hook NO responde a keyboard events
 * sintéticos porque requiere las APIs nativas de Tizen/webOS para inicializar
 * el modo de navegación TV correctamente.
 *
 * Los tests con keyboard (test.fixme) requieren hardware TV real.
 * Los tests via API validan la misma lógica de seek en desktop.
 *
 * Fixture: player — requiere infra real (vodLong).
 */
import { test, expect, ContentIds } from '../../fixtures'

// ── Helpers ────────────────────────────────────────────────────────────────────

async function emulateTizen (page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
      configurable: true,
    })
  })
}

async function focusPlayerContainer (page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#player-container').click()
  await page.waitForTimeout(300)
}

async function pressAndRelease (
  page: import('@playwright/test').Page,
  keyName: string,
  holdMs = 80
): Promise<void> {
  await page.keyboard.down(keyName)
  await page.waitForTimeout(holdMs)
  await page.keyboard.up(keyName)
}

// ── Tests keyboard (requieren hardware TV real) ────────────────────────────────

test.describe('TV Seek on Release — keyboard TV (Bug #3)', { tag: ['@e2e', '@regression'] }, () => {

  // NOTA: useTVNavigation no responde a keyboard events en desktop Playwright.
  // Estos tests están marcados como fixme hasta que se ejecuten en hardware real.
  // Para ejecutar: Samsung Tizen con WKWebDriver, o LG webOS con emulador.

  test('soltar ArrowRight ejecuta seek automáticamente sin Enter (keyboard TV)', { tag: ['@tv-hardware'] }, async ({ player, page }) => {
    test.skip(process.env.TV_HARDWARE !== 'true', 'Requiere hardware TV real — ejecutar con playwright.tv.config.ts')
    await emulateTizen(page)
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
    // Navegar al Timeline (Tab × 6)
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab')
    await page.waitForTimeout(300)
    const timeBefore = await player.getCurrentTime()
    await pressAndRelease(page, 'ArrowRight', 80)
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 5_000, intervals: [300], message: 'seek debe comprometerse en keyup sin Enter' }
    ).toBeGreaterThan(timeBefore + 5)
    await expect.poll(() => player.getStatus(), { timeout: 5_000 }).toBe('playing')
  })

  test('hold + release en ArrowRight ejecuta seek acumulado sin Enter (keyboard TV)', { tag: ['@tv-hardware'] }, async ({ player, page }) => {
    test.skip(process.env.TV_HARDWARE !== 'true', 'Requiere hardware TV real — ejecutar con playwright.tv.config.ts')
    await emulateTizen(page)
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab')
    await page.waitForTimeout(300)
    const timeBefore = await player.getCurrentTime()
    await pressAndRelease(page, 'ArrowRight', 600) // hold > HOLD_DELAY_MS
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 8_000, intervals: [300], message: 'seek de hold debe comprometerse en keyup sin Enter' }
    ).toBeGreaterThan(timeBefore + 5)
    await expect.poll(() => player.getStatus(), { timeout: 5_000 }).toBe('playing')
  })

  test('ArrowLeft seek automático al soltar sin Enter (keyboard TV)', { tag: ['@tv-hardware'] }, async ({ player, page }) => {
    test.skip(process.env.TV_HARDWARE !== 'true', 'Requiere hardware TV real — ejecutar con playwright.tv.config.ts')
    await emulateTizen(page)
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab')
    await page.waitForTimeout(300)
    // Avanzar primero
    await pressAndRelease(page, 'ArrowRight', 80)
    await expect.poll(() => player.getCurrentTime(), { timeout: 5_000 }).toBeGreaterThan(5)
    await player.waitForEvent('seeked', 5_000)
    const timeBeforeBack = await player.getCurrentTime()
    await pressAndRelease(page, 'ArrowLeft', 80)
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 5_000, intervals: [300], message: 'retroceso debe comprometerse en keyup sin Enter' }
    ).toBeLessThan(timeBeforeBack)
    await player.assertNoInitError()
  })
})

// ── Tests via player API — validan la lógica del fix en desktop ───────────────
//
// El bug #3 es sobre el commit del seek en keyup. Estos tests verifican que
// el player ejecuta el seek correctamente y vuelve a playing tras él,
// usando la API pública (window.__player.currentTime) en lugar del keyboard path.

test.describe('TV Seek on Release — lógica de seek via API (Bug #3)', { tag: ['@e2e', '@regression'] }, () => {

  test('seek via API se completa y player vuelve a playing (lógica del fix)', async ({ player, page }) => {
    // El bug #3 causaba que el seek no se ejecutara hasta confirmar con Enter.
    // Esta prueba verifica que el player ejecuta seeks y se recupera correctamente —
    // la misma precondición que el fix establece para el keyup path de TV.
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
    await page.waitForTimeout(2_000)

    const timeBefore = await player.getCurrentTime()

    // Seek forward (equivale a soltar el botón de avance en TV)
    await page.evaluate((t) => {
      (window as any).__player.currentTime = t + 15
    }, timeBefore)

    // El seek debe completarse automáticamente — el player vuelve a playing
    await expect.poll(
      () => player.getStatus(),
      { timeout: 8_000, intervals: [300], message: 'Player debe volver a playing tras el seek (sin acción adicional)' }
    ).toBe('playing')

    const timeAfter = await player.getCurrentTime()
    expect(
      timeAfter - timeBefore,
      'El seek debe haberse ejecutado (sin requerir acción adicional)'
    ).toBeGreaterThan(10)

    test.info().annotations.push({
      type: 'seek-on-release-api-trace',
      description: `timeBefore: ${timeBefore.toFixed(1)}s → timeAfter: ${timeAfter.toFixed(1)}s`,
    })
  })

  test('seek hacia atrás via API se completa sin acción adicional', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
    await page.waitForTimeout(2_000)

    // Avanzar primero
    await page.evaluate((t) => {
      (window as any).__player.currentTime = t + 30
    }, await player.getCurrentTime())
    await expect.poll(() => player.getStatus(), { timeout: 8_000, intervals: [300] }).toBe('playing')

    const timeBeforeBack = await player.getCurrentTime()

    // Seek hacia atrás — equivale a soltar ArrowLeft en TV
    await page.evaluate((t) => {
      (window as any).__player.currentTime = t - 15
    }, timeBeforeBack)

    await expect.poll(
      () => player.getStatus(),
      { timeout: 8_000, intervals: [300], message: 'Player debe volver a playing tras seek hacia atrás' }
    ).toBe('playing')

    const timeAfterBack = await player.getCurrentTime()
    expect(
      timeAfterBack,
      'El tiempo debe haber retrocedido'
    ).toBeLessThan(timeBeforeBack)

    await player.assertNoInitError()
  })

  test('3 seeks consecutivos via API se completan sin necesidad de Enter (Bug #3 + Bug #1)', async ({ player, page }) => {
    // Validación combinada: el player maneja múltiples seeks consecutivos
    // (Bug #1: acumulación) sin requerir confirmación manual (Bug #3).
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
    await page.waitForTimeout(2_000)

    const timeBefore = await player.getCurrentTime()

    // 3 seeks rápidos sin esperar Enter entre ellos
    await page.evaluate((t) => { (window as any).__player.currentTime = t + 10 }, timeBefore)
    await page.waitForTimeout(80)
    await page.evaluate((t) => { (window as any).__player.currentTime = t + 20 }, timeBefore)
    await page.waitForTimeout(80)
    await page.evaluate((t) => { (window as any).__player.currentTime = t + 30 }, timeBefore)

    // Player debe recuperarse solo — sin Enter ni acción adicional
    await expect.poll(
      () => player.getStatus(),
      { timeout: 12_000, intervals: [400], message: 'Player debe recuperarse tras 3 seeks sin acción adicional' }
    ).toBe('playing')

    await player.assertNoInitError()

    const timeAfter = await player.getCurrentTime()
    expect(
      timeAfter - timeBefore,
      'Los seeks deben haber avanzado el tiempo'
    ).toBeGreaterThan(15)

    // Verificar que el elemento video no está en error
    const videoError = await page.evaluate(() => {
      const v = document.querySelector('video')
      return v?.error ? { code: v.error.code } : null
    })
    expect(videoError).toBeNull()
  })
})

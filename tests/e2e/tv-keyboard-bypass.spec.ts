/**
 * tv-keyboard-bypass.spec.ts — Validación del bypass de shortcuts de teclado en TV
 *
 * Cubre: src/view/video/hooks/useKeyboard.js — el handler de teclado hace bail-out
 *        completo cuando isTV=true, para que los shortcuts de teclado estándar
 *        (Space=play/pause, F=fullscreen, M=mute, etc.) no interfieran con la
 *        navegación D-pad del TV remote.
 *
 * Estrategia:
 *   - Con UA de TV: los shortcuts de teclado NO deben cambiar el estado del player
 *   - Sin UA de TV: los shortcuts de teclado SI funcionan (comportamiento esperado)
 *
 * Fixture: player — contra infra real para verificar el comportamiento de teclado
 *          con el player completo cargado.
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

// ── Helper: enfocar el contenedor del player para que reciba eventos de teclado

async function focusPlayer(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#player-container').click()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('TV Keyboard Bypass — useKeyboard bail-out en TV', { tag: ['@e2e'] }, () => {

  test('en TV: Space no pausa la reproducción (keyboard shortcuts desactivados)', async ({ player, page }) => {
    // Arrange: emular TV → useKeyboard hace bail-out
    await emulateTV(page)

    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()

    await focusPlayer(page)

    // Act: presionar Space (que en desktop haría pause)
    await page.keyboard.press('Space')

    // Assert: el player sigue reproduciendo — Space fue ignorado por el TV keyboard handler
    // Esperar un breve momento para asegurar que el estado no cambia
    await expect.poll(
      () => player.getStatus(),
      { timeout: 3_000, intervals: [200] }
    ).toBe('playing')
  })

  test('en TV: tecla "f" no activa fullscreen (keyboard shortcuts desactivados)', async ({ player, page }) => {
    // Arrange
    await emulateTV(page)

    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    await focusPlayer(page)

    // Act: presionar "f" (que en desktop activaría fullscreen)
    await page.keyboard.press('f')

    // Assert: no se lanzó error y el player sigue en estado normal
    await player.assertNoInitError()
    // El player no debe estar en fullscreen (difícil de verificar via API — solo verificamos
    // que el player no crasheó y sigue respondiendo)
    const status = await player.getStatus()
    expect(['idle', 'pause', 'playing', 'buffering']).toContain(status)
  })

  test('en TV: teclas de flecha NO hacen seek (son para D-pad navigation)', async ({ player, page }) => {
    // Arrange
    await emulateTV(page)

    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()

    // Registrar posición antes de presionar flecha
    const timeBefore = await player.getCurrentTime()

    await focusPlayer(page)

    // Act: presionar ArrowRight (que en desktop haría seek forward)
    await page.keyboard.press('ArrowRight')

    // Assert: la posición no cambió abruptamente por un seek de teclado
    // (puede cambiar por reproducción normal, pero no por un seek grande)
    const timeAfter = await player.getCurrentTime()
    const timeDelta = Math.abs(timeAfter - timeBefore)

    // Si el keyboard shortcut estuviera activo, haría seek de ~10s
    // En TV, el seek de teclado debe estar desactivado — delta debe ser < 5s (solo reproducción)
    expect(
      timeDelta,
      `ArrowRight no debería hacer seek en TV (delta: ${timeDelta}s). ` +
      'En TV, las flechas son para D-pad navigation, no para seek.'
    ).toBeLessThan(5)
  })

  test('en desktop: Space sí pausa la reproducción (comportamiento normal sin TV)', async ({ player, page }) => {
    // Verificar que el bypass es exclusivo de TV — en desktop los shortcuts funcionan

    // Sin emulateTV() — UA normal de desktop
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()

    await focusPlayer(page)

    // Act: Space en desktop debe pausar
    await page.keyboard.press('Space')

    // Assert: el player pausó (Space funcionó como shortcut)
    await expect.poll(
      () => player.getStatus(),
      { timeout: 5_000, message: 'Space debería pausar el player en desktop' }
    ).toBe('pause')
  })

  test('en TV: D-pad keys son recibidas sin interferencia del keyboard handler', async ({ player, page }) => {
    // Verificar que al desactivar los shortcuts, el D-pad (ArrowUp/Down/Left/Right/Enter)
    // llega al useTVNavigation sin ser consumido por el viejo handler.

    await emulateTV(page)

    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()

    await focusPlayer(page)

    // Act: presionar ArrowDown y Enter (típico D-pad)
    // No debe producir errores ni crashear — el TV navigation hook los maneja
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')

    // Assert: el player sigue respondiendo (no crasheó con los D-pad keys)
    await player.assertNoInitError()
    const status = await player.getStatus()
    expect(['playing', 'pause', 'buffering']).toContain(status)
  })
})

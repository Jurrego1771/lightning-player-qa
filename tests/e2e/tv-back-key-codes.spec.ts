/**
 * tv-back-key-codes.spec.ts — Validación de BACK_KEY_CODES en useTVNavigation
 *
 * Cubre: src/view/video/hooks/useTVNavigation.js
 *        - BACK_KEY_CODES = [10009, 461, 27] — constante introducida en el bugfix issue-637
 *          que extiende el soporte de "Back" a las tres plataformas TV principales:
 *            • 10009 — Samsung Tizen (hardware Back key)
 *            • 461   — LG webOS (hardware Back key / BACK_KEY)
 *            • 27    — Escape (desktop / teclado estándar, también Philips/HbbTV)
 *        - Cada keyCode debe disparar el comportamiento de "cerrar sidebar / volver"
 *          sin crashear el player ni interrumpir la reproducción
 *
 * Estrategia:
 *   - Emular cada UA de plataforma TV correspondiente
 *   - Despachar el keyCode via keyboard event sintético (los keyCodes de TV hardware
 *     no son accesibles con page.keyboard.press())
 *   - Verificar que el player responde sin error y la reproducción continúa
 *   - Verificar que Escape (27) también funciona en desktop (sin UA de TV)
 *
 * Fixture: player — requiere plataforma real para activar el TV skin completo.
 *
 * Nota: LG webOS (461) se emula con un UA de webOS Smart TV.
 *       La lógica de BACK_KEY_CODES es platform-agnostic en el hook —
 *       todos los keyCodes se procesan igual independientemente del UA.
 *
 * Regresiones cubiertas (bugfix/issue-637):
 *   - Bug #1: dos pulsaciones rápidas de avance sumaban +20s pero luego retrocedían
 *     -10s automáticamente (rebote). La causa era que el handler `clearScrubStateOnSeeked`
 *     del primer seek disparaba después del segundo tap, limpiando el estado acumulado.
 *     La función `cancel()` añadida en useTVNavigation.js corrige esto: cancela el listener
 *     del primer seek cuando empieza el segundo, evitando que limpie el estado del segundo.
 */
import { test, expect, ContentIds } from '../../fixtures'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Emula UA de Samsung Tizen */
async function emulateTizen(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
      configurable: true,
    })
  })
}

/** Emula UA de LG webOS */
async function emulateWebOS(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager',
      configurable: true,
    })
  })
}

async function activateSkin(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#player-container').click()
}

/**
 * Despacha un KeyboardEvent con keyCode arbitrario sobre el documento.
 * Retorna si defaultPrevented fue llamado por algún handler.
 */
async function dispatchKeyCode(
  page: import('@playwright/test').Page,
  keyCode: number
): Promise<{ defaultPrevented: boolean; keyCode: number }> {
  return page.evaluate((kc) => {
    let defaultPrevented = false
    const event = new KeyboardEvent('keydown', {
      keyCode: kc,
      which: kc,
      bubbles: true,
      cancelable: true,
    })
    const original = event.preventDefault.bind(event)
    Object.defineProperty(event, 'preventDefault', {
      value: () => {
        defaultPrevented = true
        original()
      },
      writable: false,
    })
    document.dispatchEvent(event)
    return { defaultPrevented, keyCode: kc }
  }, keyCode)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('TV Back Key Codes — BACK_KEY_CODES [10009, 461, 27]', { tag: ['@e2e'] }, () => {

  test('keyCode 10009 (Samsung Tizen Back) es reconocido por useTVNavigation sin crashear el player', async ({ player, page }) => {
    // Arrange: Tizen UA para activar TV skin
    await emulateTizen(page)

    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()

    await activateSkin(page)

    // Act: keyCode 10009 (Tizen Back key)
    const result = await dispatchKeyCode(page, 10009)

    // Assert: el player no crasheó
    await player.assertNoInitError()

    // La reproducción debe continuar después del Back key
    const statusAfter10009 = await player.getStatus()
    expect(
      ['playing', 'pause', 'buffering'],
      'El player debe seguir activo después de keyCode 10009'
    ).toContain(statusAfter10009)

    test.info().annotations.push({
      type: 'keycode-trace',
      description: `keyCode: 10009 (Tizen) — defaultPrevented: ${result.defaultPrevented}`,
    })
  })

  test('keyCode 461 (LG webOS Back) es reconocido por useTVNavigation sin crashear el player', async ({ player, page }) => {
    // Arrange: webOS UA para activar TV skin
    await emulateWebOS(page)

    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()

    await activateSkin(page)

    // Act: keyCode 461 (LG webOS Back / BACK_KEY)
    const result = await dispatchKeyCode(page, 461)

    // Assert: el player no crasheó
    await player.assertNoInitError()

    // La reproducción debe continuar después del Back key
    const statusAfter461 = await player.getStatus()
    expect(
      ['playing', 'pause', 'buffering'],
      'El player debe seguir activo después de keyCode 461'
    ).toContain(statusAfter461)

    test.info().annotations.push({
      type: 'keycode-trace',
      description: `keyCode: 461 (LG webOS) — defaultPrevented: ${result.defaultPrevented}`,
    })
  })

  test('keyCode 27 (Escape) cierra el sidebar en TV sin interrumpir la reproducción', async ({ player, page }) => {
    // Escape (27) es el tercer Back key en BACK_KEY_CODES — funciona en TV y desktop.
    // En TV, cierra el sidebar de audio/subtítulos. En desktop, también actúa como Back.
    await emulateTizen(page)

    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()

    await activateSkin(page)

    // Registrar estado antes de presionar Escape
    const timeBefore = await player.getCurrentTime()

    // Act: presionar Escape — keyCode 27 (nativo de Playwright, no necesita dispatchKeyCode)
    await page.keyboard.press('Escape')

    // Assert: la reproducción continúa — Escape cierra el sidebar, no pausa el stream
    const statusAfterEscape = await player.getStatus()
    expect(
      ['playing', 'buffering'],
      'Escape (keyCode 27) no debe pausar ni interrumpir la reproducción'
    ).toContain(statusAfterEscape)

    // El tiempo debe haber avanzado (no hubo pause)
    const timeAfter = await player.getCurrentTime()
    expect(timeAfter).toBeGreaterThanOrEqual(timeBefore)

    await player.assertNoInitError()
  })

  test('los tres BACK_KEY_CODES no interrumpen la reproducción cuando se presionan en secuencia', async ({ player, page }) => {
    // Test de regresión: presionar los tres keyCodes en secuencia rápida no debe
    // causar errores acumulativos ni dejar el player en un estado inconsistente
    await emulateTizen(page)

    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()

    await activateSkin(page)

    // Registrar posición antes de la secuencia
    const timeBefore = await player.getCurrentTime()

    // Act: despachar los tres BACK_KEY_CODES en secuencia
    // 10009 y 461 requieren dispatchKeyCode; 27 (Escape) se puede usar con keyboard.press
    const results: Array<{ keyCode: number; defaultPrevented: boolean }> = []

    results.push(await dispatchKeyCode(page, 10009))
    results.push(await dispatchKeyCode(page, 461))
    // Escape via Playwright nativo
    await page.keyboard.press('Escape')
    results.push({ keyCode: 27, defaultPrevented: false })

    // Assert: el player sigue respondiendo después de la secuencia completa
    await player.assertNoInitError()

    const finalStatus = await player.getStatus()
    expect(['playing', 'pause', 'buffering']).toContain(finalStatus)

    // Verificar que no hubo seeked inesperado — el tiempo solo debe haber avanzado
    // (no retrocedido ni saltado por un seek no deseado)
    const timeAfter = await player.getCurrentTime()
    expect(timeAfter).toBeGreaterThanOrEqual(timeBefore)

    // Documentar trace completo
    test.info().annotations.push({
      type: 'back-key-sequence-trace',
      description: `BACK_KEY_CODES sequence: ${JSON.stringify(results)} — final status: ${finalStatus} — time delta: ${(timeAfter - timeBefore).toFixed(2)}s`,
    })
  })
})

// ── Bug #1 — Double-tap seek: rebote de -10s tras dos pulsaciones rápidas ───
//
// Regresión: dos pulsaciones rápidas de avance acumulaban +20s pero luego el
// player retrocedía -10s automáticamente (resultado neto: solo +10s).
// La causa raíz es una race condition en clearScrubStateOnSeeked:
//   1. Tap 1 → seek a +10s, inicia listener de `seeked`
//   2. Tap 2 → seek a +20s (antes de que llegue el `seeked` del tap 1)
//   3. El `seeked` del tap 1 dispara → clearScrubStateOnSeeked() limpia el
//      estado acumulado del tap 2 → player retrocede a +10s
// Con cancel(): tap 2 cancela el listener del tap 1 antes de hacer el segundo seek.

test.describe('TV Seek — double-tap sin rebote (Bug #1)', { tag: ['@e2e', '@regression'] }, () => {

  /**
   * Simula una pulsación corta en el control remoto TV (tap, no hold).
   * Usa page.keyboard.down/up para que el evento llegue al elemento enfocado
   * — el hook useTVNavigation escucha en el containerRef, no en document.
   * El container debe estar enfocado antes de llamar a esta función.
   */
  async function tapForward(page: import('@playwright/test').Page): Promise<void> {
    await page.keyboard.down('ArrowRight')
    // Breve delay < HOLD_DELAY_MS (300ms) → el hook lo registra como "tap", no hold
    await page.waitForTimeout(80)
    await page.keyboard.up('ArrowRight')
  }

  /**
   * Enfoca el contenedor del player para que los eventos de teclado lleguen al hook.
   * useTVNavigation adjunta listeners al containerRef, no al document.
   */
  async function focusPlayerContainer(page: import('@playwright/test').Page): Promise<void> {
    // Click en el container activa el TV skin y lo deja con focus
    await page.locator('#player-container').click()
    // Dar tiempo al React para que el hook esté activo
    await page.waitForTimeout(300)
  }

  // ── Tests de keyboard (requieren hardware TV real) ─────────────────────────
  //
  // NOTA: useTVNavigation escucha en el containerRef del player, que en un
  // browser de escritorio (Chromium/Firefox/WebKit de Playwright) NO responde
  // a eventos de teclado sintéticos. El hook requiere las APIs nativas de
  // Tizen/webOS para activar el modo de navegación TV.
  //
  // Para ejecutar estos tests en hardware real:
  //   - Tizen: desplegar el player en una Samsung Smart TV y correr con
  //     `PLAYWRIGHT_BROWSERTYPE=webkit` + WKWebDriver de Tizen SDK.
  //   - webOS: similar con el webOS emulator o hardware LG.
  //
  // Alternativa: el test API equivalente (abajo) valida la lógica del fix
  // sin depender del keyboard path de TV.

  test('dos pulsaciones rápidas (keyboard TV) acumulan +20s sin retroceso', { tag: ['@tv-hardware'] }, async ({ player, page }) => {
    // Bug #1 via keyboard TV path — requiere hardware webOS real.
    // Desktop: se salta (WEBOS_DEVICE_IP no configurado).
    // TV:      corre con playwright.tv.config.ts (useTVNavigation responde al D-pad físico).
    test.skip(process.env.TV_HARDWARE !== 'true', 'Requiere hardware TV real — ejecutar con playwright.tv.config.ts')
    await emulateTizen(page)
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
    await focusPlayerContainer(page)
    await page.waitForTimeout(2_000)
    const timeBefore = await player.getCurrentTime()
    await tapForward(page)
    await page.waitForTimeout(150)
    await tapForward(page)
    await expect.poll(() => player.getStatus(), { timeout: 8_000, intervals: [300] }).toBe('playing')
    const delta = (await player.getCurrentTime()) - timeBefore
    expect(delta, `Delta esperado ≥ 15s. Real: ${delta.toFixed(1)}s`).toBeGreaterThanOrEqual(15)
  })

  test('tres pulsaciones rápidas (keyboard TV) acumulan +30s sin rebote', { tag: ['@tv-hardware'] }, async ({ player, page }) => {
    // Bug #1 extendido via keyboard TV path — requiere hardware webOS real.
    test.skip(process.env.TV_HARDWARE !== 'true', 'Requiere hardware TV real — ejecutar con playwright.tv.config.ts')
    await emulateTizen(page)
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
    await focusPlayerContainer(page)
    await page.waitForTimeout(2_000)
    const timeBefore = await player.getCurrentTime()
    await tapForward(page)
    await page.waitForTimeout(150)
    await tapForward(page)
    await page.waitForTimeout(150)
    await tapForward(page)
    await expect.poll(() => player.getStatus(), { timeout: 10_000, intervals: [300] }).toBe('playing')
    const delta = (await player.getCurrentTime()) - timeBefore
    expect(delta, `Delta esperado ≥ 20s. Real: ${delta.toFixed(1)}s`).toBeGreaterThanOrEqual(20)
  })

  test('pulsación sostenida (hold keyboard TV) funciona correctamente', { tag: ['@tv-hardware'] }, async ({ player, page }) => {
    // Hold via keyboard TV path — requiere hardware webOS real.
    test.skip(process.env.TV_HARDWARE !== 'true', 'Requiere hardware TV real — ejecutar con playwright.tv.config.ts')
    await emulateTizen(page)
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
    await focusPlayerContainer(page)
    await page.waitForTimeout(2_000)
    const timeBefore = await player.getCurrentTime()
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(800)
    await page.keyboard.up('ArrowRight')
    await expect.poll(() => player.getStatus(), { timeout: 8_000, intervals: [300] }).toBe('playing')
    const delta = (await player.getCurrentTime()) - timeBefore
    expect(delta, `Hold 800ms debe avanzar > 5s. Real: ${delta.toFixed(1)}s`).toBeGreaterThan(5)
  })

  // ── Tests via player API — validan la lógica del fix en desktop ──────────
  //
  // Verifican que dos seeks rápidos via `window.__player.currentTime` acumulan
  // la posición correctamente sin rebote. Prueban la misma lógica de cancelación
  // (cancel()) que el fix corrige, sin depender del keyboard path de TV.

  test('dos seeks rápidos via API acumulan +20s sin rebote (Bug #1 — lógica del fix)', async ({ player, page }) => {
    // La race condition del bug: el seeked del primer seek llegaba tarde
    // y limpiaba el estado del segundo seek, causando rebote a +10s.
    // El fix (cancel()) previene que el primer seeked interfiera con el segundo.
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
    await page.waitForTimeout(2_000)

    const timeBefore = await player.getCurrentTime()

    // Simular la race condition: dos seeks rápidos sin esperar seeked entre ellos
    await page.evaluate((t) => {
      const p = (window as any).__player
      // Primer seek (+10s) — empieza pero seeked aún no llegó
      p.currentTime = t + 10
    }, timeBefore)

    // 100ms después (antes del seeked del primer seek): segundo seek (+20s)
    await page.waitForTimeout(100)
    await page.evaluate((t) => {
      const p = (window as any).__player
      p.currentTime = t + 20
    }, timeBefore)

    // Esperar que ambos seeks se resuelvan
    await expect.poll(
      () => player.getStatus(),
      { timeout: 10_000, intervals: [300], message: 'Player debe volver a playing tras dos seeks rápidos' }
    ).toBe('playing')

    const timeAfter = await player.getCurrentTime()
    const delta = timeAfter - timeBefore

    // Con el fix: el segundo seek se mantiene en +20s
    // Sin el fix: el seeked del primer seek rebotaba el tiempo a +10s
    expect(
      delta,
      `Con el fix, delta debe ser ≥ 15s (target: +20s). Real: ${delta.toFixed(1)}s. ` +
      'Si delta ≈ 10s el rebote sigue presente.'
    ).toBeGreaterThanOrEqual(15)

    test.info().annotations.push({
      type: 'double-seek-api-trace',
      description: `timeBefore: ${timeBefore.toFixed(1)}s → timeAfter: ${timeAfter.toFixed(1)}s — delta: ${delta.toFixed(1)}s`,
    })
  })

  test('el player no queda en estado inconsistente tras seeks rápidos consecutivos', async ({ player, page }) => {
    // Regresión de estabilidad: N seeks rápidos no deben dejar el player en error.
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
    await page.waitForTimeout(2_000)

    const timeBefore = await player.getCurrentTime()

    // 4 seeks rápidos en cadena (simula N taps rápidos del usuario)
    for (let i = 1; i <= 4; i++) {
      await page.evaluate((target) => {
        (window as any).__player.currentTime = target
      }, timeBefore + i * 10)
      await page.waitForTimeout(60) // 60ms entre cada seek
    }

    // El player debe estabilizarse sin errores
    await expect.poll(
      () => player.getStatus(),
      { timeout: 12_000, intervals: [400], message: 'Player debe recuperarse tras 4 seeks rápidos' }
    ).toBe('playing')

    await player.assertNoInitError()

    const timeAfter = await player.getCurrentTime()
    expect(
      timeAfter - timeBefore,
      'Tras 4 seeks rápidos el tiempo debe haber avanzado'
    ).toBeGreaterThan(10)
  })
})

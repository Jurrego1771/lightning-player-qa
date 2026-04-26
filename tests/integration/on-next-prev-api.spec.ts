/**
 * tests/integration/on-next-prev-api.spec.ts
 *
 * Contrato de la API setter/getter de player.onNext / player.onPrev.
 * Sin interacción de UI — solo verifica el comportamiento del setter en JS.
 *
 * Comportamiento bajo test:
 *   - getter devuelve la misma referencia de función asignada
 *   - setter acepta null y coerciona valores no-función a null sin throw
 *   - onNext y onPrev son propiedades independientes
 *
 * Tests de comportamiento por view (callback invoca, sourcechange suprimido,
 * null-restore) están en on-next-prev-views.spec.ts.
 * Regresión live/DVR está en on-next-prev-radio-live-dvr-regression.spec.ts.
 */

import { test, expect, MockContentIds } from '../../fixtures'

test.describe('onNext / onPrev — contrato API setter/getter', {
  tag: ['@integration'],
}, () => {

  // ── Getter conserva referencia ────────────────────────────────────────────

  test('onNext = fn — getter devuelve la misma referencia', async ({ isolatedPlayer, page }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    const ok = await page.evaluate(() => {
      const fn = () => {}
      ;(window as any).__player.onNext = fn
      return (window as any).__player.onNext === fn
    })
    expect(ok).toBe(true)
  })

  test('onPrev = fn — getter devuelve la misma referencia', async ({ isolatedPlayer, page }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    const ok = await page.evaluate(() => {
      const fn = () => {}
      ;(window as any).__player.onPrev = fn
      return (window as any).__player.onPrev === fn
    })
    expect(ok).toBe(true)
  })

  // ── Null assignment ───────────────────────────────────────────────────────

  test('onNext = null — getter devuelve null sin throw', async ({ isolatedPlayer, page }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    const result = await page.evaluate(() => {
      try {
        const fn = () => {}
        ;(window as any).__player.onNext = fn
        ;(window as any).__player.onNext = null
        return { value: (window as any).__player.onNext, threw: false }
      } catch (e: unknown) {
        return { value: null, threw: true, msg: e instanceof Error ? e.message : String(e) }
      }
    })

    expect(result.threw, `setter lanzó: ${(result as any).msg}`).toBe(false)
    expect(result.value).toBeNull()
  })

  test('onPrev = null — getter devuelve null sin throw', async ({ isolatedPlayer, page }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    const result = await page.evaluate(() => {
      try {
        const fn = () => {}
        ;(window as any).__player.onPrev = fn
        ;(window as any).__player.onPrev = null
        return { value: (window as any).__player.onPrev, threw: false }
      } catch (e: unknown) {
        return { value: null, threw: true, msg: e instanceof Error ? e.message : String(e) }
      }
    })

    expect(result.threw, `setter lanzó: ${(result as any).msg}`).toBe(false)
    expect(result.value).toBeNull()
  })

  // ── Coerción de valores no-función ───────────────────────────────────────

  test('onNext = string — coercionado a null sin throw', async ({ isolatedPlayer, page }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    const result = await page.evaluate(() => {
      try {
        ;(window as any).__player.onNext = 'not-a-function'
        return { value: (window as any).__player.onNext, threw: false }
      } catch (e: unknown) {
        return { value: null, threw: true, msg: e instanceof Error ? e.message : String(e) }
      }
    })

    expect(result.threw, `setter lanzó: ${(result as any).msg}`).toBe(false)
    expect(result.value).toBeNull()
  })

  test('onPrev = número — coercionado a null sin throw', async ({ isolatedPlayer, page }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    const result = await page.evaluate(() => {
      try {
        ;(window as any).__player.onPrev = 42
        return { value: (window as any).__player.onPrev, threw: false }
      } catch (e: unknown) {
        return { value: null, threw: true, msg: e instanceof Error ? e.message : String(e) }
      }
    })

    expect(result.threw, `setter lanzó: ${(result as any).msg}`).toBe(false)
    expect(result.value).toBeNull()
  })
})

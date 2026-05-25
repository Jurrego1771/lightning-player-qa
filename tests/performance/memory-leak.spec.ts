/**
 * memory-leak.spec.ts — destroy() no acumula heap en ciclos repetidos
 *
 * Valida el patrón SPA: mismo DOM, múltiples init/play/destroy en la misma página.
 * Si destroy() no limpia correctamente (listeners, hls.js instance, referencias),
 * el heap crece monotónicamente. El threshold de 20% absorbe ruido de GC en V8.
 *
 * Usa CDP HeapProfiler.collectGarbage + performance.memory (Chromium only).
 * Corre en el proyecto "performance" de playwright.config.ts.
 */
import { test, expect, MockContentIds } from '../../fixtures'
import { createCDPSession } from '../../helpers/qoe-metrics'

test.describe('Memory — destroy() lifecycle', { tag: ['@performance'] }, () => {

  test('destroy() no acumula heap en 4 ciclos init-play-destroy (Chromium)', async ({ isolatedPlayer, page, browserName }) => {
    test.skip(browserName !== 'chromium', 'performance.memory solo disponible en Chromium')
    // Use isolatedPlayer (local stream via localhost:9001) — this test measures heap growth,
    // not CDN speed. Real CDN makes each cycle non-deterministic and blows the 60s timeout.
    test.setTimeout(180_000)

    const client = await createCDPSession(page)

    // Boot via isolatedPlayer so platform mocks + harness script are ready.
    // Destroy immediately — cycles will re-init via __initPlayer on the same page.
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await page.evaluate(() => (window as any).__player?.destroy?.())

    const runCycle = async (): Promise<number> => {
      // Reset __qa so waitForFunction doesn't resolve from prior cycle's state
      await page.evaluate(() => {
        ;(window as any).__qa = {
          ready: false, initialized: false, events: [], eventData: {}, errors: [], initError: null, initMethod: null,
        }
      })

      await page.evaluate((cfg) => (window as any).__initPlayer(cfg), {
        type: 'media', id: MockContentIds.vod, autoplay: true,
      } as Record<string, unknown>)

      await page.waitForFunction(
        () => (window as any).__qa?.events?.includes('playing'),
        { timeout: 25_000 },
      )

      await page.evaluate(() => (window as any).__player?.destroy?.())

      // Force GC before measuring — CDP command blocks until GC completes
      await client.send('HeapProfiler.enable')
      await client.send('HeapProfiler.collectGarbage')

      return page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 0)
    }

    // Warmup: first init carries one-time setup overhead — excluded from measurement
    await runCycle()

    const heap1 = await runCycle()
    const heap2 = await runCycle()
    const heap3 = await runCycle()
    const heap4 = await runCycle()

    // Heap must not grow consistently across cycles.
    // A real leak causes monotonic growth; GC noise causes random fluctuation.
    // 20% threshold over 4 cycles is conservative enough to avoid false positives.
    const growth = heap1 > 0 ? (heap4 - heap1) / heap1 : 0

    expect(
      growth,
      `Heap creció ${(growth * 100).toFixed(1)}% de ciclo 1 a ciclo 4 — posible memory leak en destroy(). heap1=${heap1} heap2=${heap2} heap3=${heap3} heap4=${heap4}`,
    ).toBeLessThan(0.20)
  })

})

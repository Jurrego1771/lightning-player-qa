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
import { test, expect, ContentIds } from '../../fixtures'
import { createCDPSession } from '../../helpers/qoe-metrics'
import { getEnvironmentConfig } from '../../config/environments'

test.describe('Memory — destroy() lifecycle', { tag: ['@performance'] }, () => {

  test('destroy() no acumula heap en 4 ciclos init-play-destroy (Chromium)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'performance.memory solo disponible en Chromium')

    const envConfig = getEnvironmentConfig()
    const client = await createCDPSession(page)

    // Navigate once — all cycles on same page (SPA pattern, no navigation between cycles)
    await page.goto('http://localhost:3000/index.html', { waitUntil: 'domcontentloaded' })
    await page.addScriptTag({ url: envConfig.playerScriptUrl })
    await page.waitForFunction(() => typeof (window as any).loadMSPlayer === 'function', { timeout: 15_000 })

    const runCycle = async (): Promise<number> => {
      // Reset __qa so waitForFunction doesn't resolve from prior cycle's state
      await page.evaluate(() => {
        ;(window as any).__qa = {
          ready: false, initialized: false, events: [], eventData: {}, errors: [], initError: null, initMethod: null,
        }
      })

      await page.evaluate((cfg) => (window as any).__initPlayer(cfg), {
        type: 'media', id: ContentIds.vodShort, autoplay: true,
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

/**
 * Phase 3 — Player lifecycle & destroy
 *
 * Shaka equivalente: player_unit.js — destroy, load/unload, configure validation
 *
 * Cubre:
 *   3.1 destroy() deja el DOM limpio y no emite eventos nuevos
 *   3.2 destroy() durante buffering no crashea ni deja promesas colgadas
 *   3.3 load → destroy → re-init en la misma página funciona
 *   3.4 player.load() con nuevo contenido en caliente
 *   3.5 Rapid load/destroy × 5 sin memory leak significativo (CDP heap)
 *   3.6 loadConfig() con config inválida — player sobrevive
 *
 * Todos los tests usan isolatedPlayer + MockContentIds para determinismo.
 */
import { test, expect, MockContentIds } from '../../fixtures'

test.describe('Player Lifecycle — destroy / reload / config', { tag: ['@integration'] }, () => {

  // ── 3.1 ──────────────────────────────────────────────────────────────────
  test('3.1 destroy() limpia el DOM y el player no emite eventos nuevos', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Pre-destroy: existe <video> o <audio> dentro del container
    const preMedia = await page.locator('#player-container video, #player-container audio').count()
    expect(preMedia).toBeGreaterThan(0)

    // Marcar snapshot de eventos para detectar emisión post-destroy
    await page.evaluate(() => { (window as any).__qa.eventsPreDestroy = [...(window as any).__qa.events] })

    await player.destroy()

    // Esperar a que la limpieza interna del player termine
    await page.waitForTimeout(1_000)

    // DOM: el container ya no debe tener elementos de media activos
    const postMedia = await page.locator('#player-container video, #player-container audio').count()
    expect(postMedia).toBe(0)

    // No deben llegar eventos nuevos (excepto posibles eventos de destroy en sí)
    // Filtrar timeupdate que puede haberse disparado antes del corte.
    const delta = await page.evaluate(() => {
      const pre = (window as any).__qa.eventsPreDestroy as string[]
      const post = (window as any).__qa.events as string[]
      return post.slice(pre.length)
    })
    const interesting = (delta as string[]).filter(e => !['timeupdate', 'pause', 'emptied', 'abort', 'suspend'].includes(e))
    expect(interesting).toEqual([])
  })

  // ── 3.2 ──────────────────────────────────────────────────────────────────
  test('3.2 destroy() durante buffering no crashea ni deja promesas colgadas', async ({ isolatedPlayer: player, page }) => {
    // Forzar buffering: demorar segmentos HLS indefinidamente después del inicial
    let segCount = 0
    await page.route('**/*.ts', async (route) => {
      segCount++
      if (segCount > 2) {
        // Cuelga el request — el player entrará en buffering
        await new Promise(r => setTimeout(r, 20_000))
        await route.abort()
      } else {
        await route.continue()
      }
    })

    const unhandled: string[] = []
    page.on('pageerror', (err) => unhandled.push(err.message))

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Seek para agotar buffer rápido y caer en buffering
    await player.seek(5)
    // Dar tiempo a que hls.js consuma el buffer e intente el siguiente segmento
    await page.waitForTimeout(2_000)

    // Destruir en medio del stall — si rejecta, el test falla
    await player.destroy()

    // Ventana corta para capturar errores asíncronos post-destroy
    await page.waitForTimeout(2_000)

    expect(unhandled, `Uncaught errors post-destroy: ${unhandled.join(' | ')}`).toEqual([])
  })

  // ── 3.3 ──────────────────────────────────────────────────────────────────
  test('3.3 load → destroy → re-init en la misma página produce segunda instancia funcional', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.destroy()
    await page.waitForTimeout(500)

    // Re-inicializar sobre el mismo harness.
    // Resetear __qa y reusar __initPlayer que expone el harness.
    await page.evaluate((id) => {
      ;(window as any).__qa = { ready: false, initialized: false, events: [], eventData: {}, errors: [], initError: null }
      ;(window as any).__initPlayer({ type: 'media', id, autoplay: true })
    }, MockContentIds.vod)

    await page.waitForFunction(
      () => (window as any).__qa?.initialized === true || (window as any).__qa?.initError != null,
      { timeout: 30_000 }
    )
    await player.assertNoInitError()
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
  })

  // ── 3.4 ──────────────────────────────────────────────────────────────────
  test('3.4 player.load() en caliente transiciona a nuevo contenido', async ({ isolatedPlayer: player, page }) => {
    // Usamos dos IDs mock distintos — el platform mock responde con el mismo stream,
    // pero el player dispara sourcechange y vuelve a alcanzar ready.
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await player.load({ type: 'media', id: MockContentIds.episode })

    await player.waitForEvent('sourcechange', 10_000)
    await player.waitForReady(30_000)
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
  })

  // ── 3.5 ──────────────────────────────────────────────────────────────────
  test('3.5 Rapid load/destroy × 5 sin memory leak significativo', async ({ isolatedPlayer: player, page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP heap sampling solo disponible en Chromium')

    // Primera carga para establecer baseline
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    const client = await page.context().newCDPSession(page)

    const heapUsed = async (): Promise<number> => {
      // Forzar GC via CDP antes de medir — reduce ruido del heap sampling
      try { await (client as any).send('HeapProfiler.collectGarbage') } catch { /* noop */ }
      return page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 0)
    }

    const baseline = await heapUsed()

    for (let i = 0; i < 5; i++) {
      await player.destroy()
      await page.waitForTimeout(300)
      await page.evaluate((id) => {
        ;(window as any).__qa = { ready: false, initialized: false, events: [], eventData: {}, errors: [], initError: null }
        ;(window as any).__initPlayer({ type: 'media', id, autoplay: true })
      }, MockContentIds.vod)
      await page.waitForFunction(() => (window as any).__qa?.initialized === true, { timeout: 30_000 })
    }

    // Destruir la última instancia para medir heap en estado "idle"
    await player.destroy()
    await page.waitForTimeout(1_000)
    const after = await heapUsed()

    const deltaMB = (after - baseline) / (1024 * 1024)
    // Heurística: tras 5 ciclos, el delta no debe superar 30MB.
    // Un leak real escala ~linealmente y cruza este umbral fácilmente.
    expect.soft(deltaMB, `Heap delta post 5x load/destroy: ${deltaMB.toFixed(1)}MB`).toBeLessThan(30)
  })

  // ── 3.6 ──────────────────────────────────────────────────────────────────
  test('3.6 loadConfig() con config inválida no crashea y conserva el estado anterior', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    const prevDuration = await player.getDuration()

    // Invocar loadConfig con opciones basura — no debería tirar ni destruir al player.
    const result = await page.evaluate(async () => {
      try {
        const p = (window as any).__player
        if (typeof p.loadConfig !== 'function') return { skipped: true }
        await p.loadConfig({ type: 'not-a-real-type', id: null, bogus: { x: 1 } })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    })

    // El player puede rechazar la config (ok:false) o aceptarla como no-op (ok:true).
    // Lo que NO puede pasar: que el player quede muerto o tire unhandled.
    expect(result).toBeDefined()

    // Post-loadConfig: el player sigue vivo y con el contenido original
    const status = await player.getStatus()
    expect(['playing', 'buffering', 'pause']).toContain(status)
    const duration = await player.getDuration()
    expect(duration).toBeCloseTo(prevDuration, 0)
  })
})

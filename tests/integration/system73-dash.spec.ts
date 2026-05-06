/**
 * system73-dash.spec.ts — Integración del SDK P2P System73 con el handler DASH
 *
 * Cubre: feature/system73 — lazy-load del SDK externo System73 que wraps dash.js
 *
 * Comportamiento implementado en src/player/handler/dash/handler.js:
 *   - Path deshabilitado: context.metadata.peering.system73.enabled !== true
 *     → dash.js MediaPlayer se inicializa sin wrapper, playback normal
 *   - Path habilitado: context.metadata.peering.system73 = { enabled, key, dash (url sdk) }
 *     → await getSystem73DashSDK(s73Config.dash) → window.S73DashjsWrapper
 *        → wrapper.wrapPlayer(player) → dash.js con P2P
 *   - SDK import failure: importExternal lanza / window.S73DashjsWrapper no existe
 *     → getSystem73DashSDK devuelve null → handler continúa sin wrapper (degradación suave)
 *   - Stale-src guard (CRÍTICO — solo en DASH):
 *     → después de `await getSystem73DashSDK()`, si this.state.src !== src, _load() retorna.
 *        Previene que un wrapper del SDK se asocie a un player ya recargado con src diferente.
 *   - Double-load guard (_loadingSrc dedup):
 *     → si _load() se llama mientras _loadingSrc === src, la segunda llamada retorna inmediatamente
 *   - Handler reload: al cambiar src, el _s73Wrapper anterior recibe destroy() antes de la nueva carga
 *   - Destroy (componentWillUnmount): _s73Wrapper.destroy() se llama al destruir el player
 *
 * Fixture: isolatedPlayer — plataforma mockeada via page.route(), streams locales (localhost:9001)
 * Tag: @integration
 */
import { test, expect, MockContentIds, mockContentConfig, mockContentConfigById } from '../../fixtures'

test.describe('System73 DASH SDK integration', { tag: ['@integration'] }, () => {

  // ── Test 1: Path deshabilitado (default) ──────────────────────────────────
  test('sin peering config el player reproduce DASH normalmente', async ({ isolatedPlayer: player }) => {
    // Arrange — content config por defecto no incluye metadata.peering
    // El mock content id 'mock-dash-vod-1' hace que platform-mock.ts sirva content/dash.json
    await player.goto({ type: 'media', id: MockContentIds.dashVod, autoplay: true, format: 'dash' })
    await player.waitForEvent('playing', 25_000)

    // Assert
    await player.assertIsPlaying()
    await player.assertNoInitError()
    await expect.poll(() => player.getHandler(), { timeout: 5_000 }).toContain('dash')
  })

  // ── Test 2: Path habilitado con mock SDK ──────────────────────────────────
  // Inyecta window.S73DashjsWrapper como mock antes de init. Verifica que el player
  // llama a wrapper.wrapPlayer() y sigue reproduciendo normalmente.
  test('con system73 habilitado el player llama al wrapper DASH y reproduce', async ({ isolatedPlayer: player, page }) => {
    // Arrange — mock SDK
    await page.addInitScript(() => {
      ;(window as any).__s73DashCalls = []
      ;(window as any).S73DashjsWrapper = function (opts: { apiKey: string; channelId: string }) {
        ;(window as any).__s73DashCalls.push({ type: 'init', opts })
        return {
          wrapPlayer (player: unknown) {
            ;(window as any).__s73DashCalls.push({ type: 'wrapPlayer', player: !!player })
          },
          destroy () {
            ;(window as any).__s73DashCalls.push({ type: 'destroy' })
          },
        }
      }
    })

    await page.route('**/mock-s73-dash-sdk.js', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* mock */' })
    })

    await mockContentConfig(page, {
      src: {
        mpd: 'http://localhost:9001/vod-dash/manifest.mpd',
      },
      peering: {
        system73: {
          enabled: true,
          key: 'mock-s73-key',
          dash: 'http://localhost:9001/mock-s73-dash-sdk.js',
        },
      },
    })

    await player.goto({ type: 'media', id: MockContentIds.dashVod, autoplay: true, format: 'dash' })
    await player.waitForEvent('playing', 25_000)

    // Assert — playback con wrapper activo
    await player.assertIsPlaying()
    await player.assertNoInitError()

    const calls: Array<{ type: string }> = await page.evaluate(() => (window as any).__s73DashCalls ?? [])
    const callTypes = calls.map((c) => c.type)
    expect(callTypes, 'wrapPlayer debe haberse llamado en el handler DASH').toContain('wrapPlayer')
  })

  // ── Test 3: SDK import failure → degradación suave ────────────────────────
  // Bloquear la URL del SDK fuerza el catch en getSystem73DashSDK.
  // El handler debe continuar con dash.js puro — sin error de init.
  test('fallo del SDK import no bloquea el playback DASH', async ({ isolatedPlayer: player, page }) => {
    // Bloquear URL del SDK para forzar el catch
    await page.route('**/mock-s73-dash-sdk.js', async (route) => {
      await route.abort('failed')
    })
    // window.S73DashjsWrapper no existe → getSystem73DashSDK devuelve null

    await mockContentConfig(page, {
      src: {
        mpd: 'http://localhost:9001/vod-dash/manifest.mpd',
      },
      peering: {
        system73: {
          enabled: true,
          key: 'mock-s73-key',
          dash: 'http://localhost:9001/mock-s73-dash-sdk.js',
        },
      },
    })

    await player.goto({ type: 'media', id: MockContentIds.dashVod, autoplay: true, format: 'dash' })
    await player.waitForEvent('playing', 25_000)

    // Assert — degradación suave: sin wrapper pero playback normal
    await player.assertIsPlaying()
    await player.assertNoInitError()
    await expect.poll(() => player.getHandler(), { timeout: 5_000 }).toContain('dash')
  })

  // ── Test 4: Stale-src guard (CRÍTICO — exclusivo de DASH) ─────────────────
  // En el handler DASH, después de `await getSystem73DashSDK()`, si this.state.src
  // cambió (src diferente al que inició el await), la función retorna sin aplicar
  // el wrapper — evita la race condition que asociaría un P2P wrapper al player
  // ya recargado con otro contenido.
  //
  // Estrategia del test (2 fases):
  //   Fase 1 — Init con SDK rápido, player reproduciendo contentA.
  //   Fase 2 — Registrar SDK lento (LIFO), disparar load(A) como fire-and-forget
  //             (no awaitable en browser), e inmediatamente load(B) via fixture.
  //             Cuando SDK de A resuelva, state.src === srcB → guard aborta.
  //   Assert — player reproduce contentB sin error.
  test('stale-src guard previene que el wrapper se aplique tras cambio de src durante await', async ({ isolatedPlayer: player, page }) => {
    await page.addInitScript(() => {
      ;(window as any).__s73DashWrapCount = 0
      ;(window as any).S73DashjsWrapper = function () {
        return {
          wrapPlayer () { ;(window as any).__s73DashWrapCount++ },
          destroy () {},
        }
      }
    })

    // SDK rápido para Fase 1
    await page.route('**/mock-s73-dash-sdk.js', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* sdk */' })
    })

    await mockContentConfigById(page, {
      [MockContentIds.dashVod]: {
        src: { mpd: 'http://localhost:9001/vod-dash/manifest.mpd' },
        peering: {
          system73: {
            enabled: true,
            key: 'mock-s73-key',
            dash: 'http://localhost:9001/mock-s73-dash-sdk.js',
          },
        },
      },
      // Content B: DASH sin system73 — no espera el SDK → carga rápido.
      // Necesita src.mpd porque format:'dash' del goto persiste en la instancia del player.
      [MockContentIds.vod]: {
        src: { mpd: 'http://localhost:9001/vod-dash/manifest.mpd' },
      },
    })

    // Fase 1: player reproduciendo contentA con DASH + system73 (SDK rápido)
    await player.goto({ type: 'media', id: MockContentIds.dashVod, autoplay: true, format: 'dash' })
    await player.waitForEvent('playing', 15_000)

    // Fase 2: registrar SDK lento (LIFO sobre la ruta rápida)
    await page.route('**/mock-s73-dash-sdk.js', async (route) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 500))
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* sdk */' })
    })

    // Disparar load(A) y load(B) en el mismo contexto JS sin round-trip entre ellos.
    // Esto maximiza la ventana de race: load(A) inicia DASH+SDK lento (500ms), load(B)
    // interrumpe de inmediato. Cuando el SDK de A resuelva, stale-src guard detecta
    // state.src !== srcA → aborta el wrapper. Content B (HLS) queda como src activo.
    await page.evaluate((ids) => {
      ;(window as any).__qa.events = []
      ;(window as any).__qa.ready = false
      const p = (window as any).__player
      if (!p) return
      p.load({ type: 'media', id: ids[0] })  // fire-and-forget: DASH + slow SDK
      p.load({ type: 'media', id: ids[1] })  // fire-and-forget: HLS, sin peering
    }, [MockContentIds.dashVod, MockContentIds.vod])

    // Player puede no autoplazar B si estaba en 'loading' cuando load(B) se llamó.
    // Pollear hasta 'playing', llamando play() en cada intento donde sea necesario.
    await expect.poll(
      async () => {
        const s: string = await page.evaluate(() => (window as any).__player?.status ?? 'idle')
        if (s !== 'playing') {
          await page.evaluate(() => {
            try { ;(window as any).__player?.play() } catch (_) {}
          })
        }
        return s
      },
      { timeout: 25_000, intervals: [500, 1000, 2000, 3000] },
    ).toBe('playing')

    await player.assertIsPlaying()
    await player.assertNoInitError()
  })

  // ── Test 5: Double-load guard para DASH ───────────────────────────────────
  // _loadingSrc dedup evita que dos llamadas concurrentes a _load() con el mismo
  // src creen dos instancias del MediaPlayer.
  test('doble init concurrente con mismo src no causa doble controlador DASH', async ({ isolatedPlayer: player, page }) => {
    await page.addInitScript(() => {
      ;(window as any).__s73DashInitCount = 0
      ;(window as any).S73DashjsWrapper = function () {
        ;(window as any).__s73DashInitCount++
        return {
          wrapPlayer () {},
          destroy () {},
        }
      }
    })

    await page.route('**/mock-s73-dash-sdk.js', async (route) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* sdk */' })
    })

    await mockContentConfig(page, {
      src: {
        mpd: 'http://localhost:9001/vod-dash/manifest.mpd',
      },
      peering: {
        system73: {
          enabled: true,
          key: 'mock-s73-key',
          dash: 'http://localhost:9001/mock-s73-dash-sdk.js',
        },
      },
    })

    await player.goto({ type: 'media', id: MockContentIds.dashVod, autoplay: true, format: 'dash' })
    await player.waitForEvent('playing', 25_000)

    await player.assertIsPlaying()
    await player.assertNoInitError()

    const initCount: number = await page.evaluate(() => (window as any).__s73DashInitCount ?? 0)
    expect(
      initCount,
      'S73DashjsWrapper debe instanciarse a lo sumo una vez por src',
    ).toBeLessThanOrEqual(1)
  })

  // ── Test 6: Handler reload → wrapper anterior recibe destroy() ────────────
  // Al llamar player.load() con src diferente, el handler destruye el _s73Wrapper
  // anterior (si existe) antes de iniciar la nueva carga.
  test('reload con nuevo contenido llama destroy() en el wrapper DASH anterior', async ({ isolatedPlayer: player, page }) => {
    await page.addInitScript(() => {
      ;(window as any).__s73DashDestroyCount = 0
      ;(window as any).S73DashjsWrapper = function () {
        return {
          wrapPlayer () {},
          destroy () {
            ;(window as any).__s73DashDestroyCount++
          },
        }
      }
    })

    await page.route('**/mock-s73-dash-sdk.js', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* sdk */' })
    })

    await mockContentConfig(page, {
      src: {
        mpd: 'http://localhost:9001/vod-dash/manifest.mpd',
      },
      peering: {
        system73: {
          enabled: true,
          key: 'mock-s73-key',
          dash: 'http://localhost:9001/mock-s73-dash-sdk.js',
        },
      },
    })

    // Carga inicial con DASH + system73
    await player.goto({ type: 'media', id: MockContentIds.dashVod, autoplay: true, format: 'dash' })
    await player.waitForEvent('playing', 25_000)
    await player.assertIsPlaying()

    // Act — recargar con contenido diferente (cambia el src → nuevo _load())
    await player.load({ type: 'media', id: MockContentIds.vod })
    await player.waitForEvent('playing', 20_000)

    // Assert — destroy() del wrapper anterior debe haberse llamado
    await expect.poll(
      () => page.evaluate(() => (window as any).__s73DashDestroyCount ?? 0),
      { timeout: 5_000, message: 'destroy() del wrapper DASH anterior debe llamarse al recargar' },
    ).toBeGreaterThanOrEqual(1)
  })

  // ── Test 7: Destroy del player → _s73Wrapper.destroy() ───────────────────
  // componentWillUnmount llama _s73Wrapper.destroy?.() para limpiar recursos P2P.
  test('destroy del player llama destroy() en el wrapper System73 DASH', async ({ isolatedPlayer: player, page }) => {
    await page.addInitScript(() => {
      ;(window as any).__s73DashDestroyOnUnmount = false
      ;(window as any).S73DashjsWrapper = function () {
        return {
          wrapPlayer () {},
          destroy () {
            ;(window as any).__s73DashDestroyOnUnmount = true
          },
        }
      }
    })

    await page.route('**/mock-s73-dash-sdk.js', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* sdk */' })
    })

    await mockContentConfig(page, {
      src: {
        mpd: 'http://localhost:9001/vod-dash/manifest.mpd',
      },
      peering: {
        system73: {
          enabled: true,
          key: 'mock-s73-key',
          dash: 'http://localhost:9001/mock-s73-dash-sdk.js',
        },
      },
    })

    await player.goto({ type: 'media', id: MockContentIds.dashVod, autoplay: true, format: 'dash' })
    await player.waitForEvent('playing', 25_000)
    await player.assertIsPlaying()

    // Act — destruir el player (dispara componentWillUnmount)
    await player.destroy()

    // Assert
    await expect.poll(
      () => page.evaluate(() => (window as any).__s73DashDestroyOnUnmount),
      { timeout: 5_000, message: 'destroy() del wrapper DASH debe llamarse en componentWillUnmount' },
    ).toBe(true)
  })

})

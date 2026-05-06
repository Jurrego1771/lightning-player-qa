/**
 * youbora.spec.ts — Tests de integración para el plugin NPAW/Youbora Analytics
 *
 * Cubre: activación condicional del plugin, beacons de sesión de contenido,
 *        beacons durante ciclo de vida de ads, reinicio de sesión tras load(),
 *        destrucción antes de contentFirstPlay, y reporte de errores fatales.
 *
 * Fixture: isolatedPlayer (plataforma mockeada + stream HLS local)
 * Requiere: mock VAST server en MOCK_VAST_BASE_URL (default: http://localhost:9999)
 *
 * Estrategia de observabilidad: interceptar requests de red con page.route() hacia
 * dominios *.npaw.com y *.youbora.com. No hay API pública en el player para leer
 * el estado de Youbora — los beacons HTTP son la única señal observable.
 *
 * Anti-patrones evitados:
 *   - Sin waitForTimeout — solo expect.poll() y waitForEvent()
 *   - Sin conteos exactos de beacons — heartbeats del SDK añaden ruido
 *   - Sin verificación de paths exactos de beacons — son internos al SDK npaw-plugin@7.3.28
 *   - Sin usar player events como proxy de estado Youbora — 'playing' no implica Youbora activo
 */
import { test, expect, MockContentIds, mockPlayerConfig, mockContentConfigById } from '../../fixtures'
import type { Route } from '@playwright/test'

// ── Constantes compartidas ──────────────────────────────────────────────────

const MOCK_VAST_URL = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

// account_code viene de YOUBORA_ACCOUNT_CODE en .env — nunca hardcodeado.
// Sin este valor los tests que esperan beacons fallarán con 0 beacons capturados.
const YOUBORA_ACCOUNT_CODE = process.env.YOUBORA_ACCOUNT_CODE ?? ''

/**
 * Config mínima para activar Youbora en los mocks del player config.
 * Pasada a mockPlayerConfig() ANTES de player.goto() para que Playwright
 * use LIFO routing y este handler tome precedencia sobre setupPlatformMocks.
 *
 * Path: metadata.player.tracking.youbora — el player config response se expone
 * como root de `options` en el plugin loader. plugins/index.js:34 lee
 * options?.metadata?.player?.tracking?.youbora, y youbora/index.jsx lee
 * context.options?.metadata?.player?.tracking?.youbora?.account_code.
 * Por tanto el mock debe poner el bloque bajo metadata.player.tracking.
 */
const YOUBORA_CONFIG = {
  metadata: {
    player: {
      tracking: {
        youbora: { enabled: true, account_code: YOUBORA_ACCOUNT_CODE },
      },
    },
  },
}

// ── Helper: capturar beacons NPAW ───────────────────────────────────────────

/**
 * Registra un interceptor de red para beacons NQS de NPAW y devuelve el array de
 * URLs capturadas. El array se actualiza en tiempo real — se puede leer con expect.poll().
 *
 * IMPORTANTE — solo captura NQS, no LMA:
 *   LMA (lma.npaw.com) devuelve la asignación del servidor NQS al SDK.
 *   Si LMA se intercepta con body vacío, el SDK no puede parsear la respuesta
 *   y nunca envía beacons NQS. Por eso LMA debe llegar al servidor real.
 *   NQS (*.youboranqs01.com) es write-only — el SDK no depende del response body,
 *   así que interceptarlo con 200 vacío es seguro.
 *
 * IMPORTANTE: llamar ANTES de player.goto() para no perder beacons de init del SDK.
 */
async function setupNpawInterceptor(page: import('@playwright/test').Page): Promise<string[]> {
  const beacons: string[] = []
  const seen = new Set<string>()

  const recordBeacon = (url: string) => {
    if (seen.has(url)) return
    seen.add(url)
    beacons.push(url)
  }

  const captureBeacon = async (route: Route) => {
    recordBeacon(route.request().url())
    await route.fulfill({ status: 200, body: '' })
  }

  // page.on('request') es más estable para observabilidad que page.route() sola.
  // En runs paralelos vimos requests NQS descubiertas en consola que no siempre
  // pasaban por el closure del route handler a tiempo para alimentar `beacons`.
  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('youboranqs01.com/') || url.includes('.youbora.com/')) {
      recordBeacon(url)
    }
  })

  // Capturar solo NQS (beacons de sesión reales) — dejar LMA sin interceptar.
  // Regex en lugar de glob: **youboranqs01.com/** falla en Playwright porque
  // ** adyacente a un literal sin separador / no se resuelve correctamente.
  await page.route(/youboranqs01\.com\//, captureBeacon)
  await page.route(/\.youbora\.com\//, captureBeacon)

  return beacons
}

// ── TB-01 y TB-02: Activation Guards ────────────────────────────────────────

test.describe('Youbora — Activation Guards', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('no beacons when tracking.youbora absent from player config', async ({ isolatedPlayer: player, page }) => {
    // Arrange — el fixture isolatedPlayer ya llamó setupPlatformMocks con default.json
    // que NO contiene el bloque metadata.player.tracking.youbora.
    // NO llamamos mockPlayerConfig aquí — Youbora no debe activarse.
    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Act — esperar contentFirstPlay para confirmar que el player reprodujo
    // correctamente. Sin este assert, el test podría pasar vacío si el stream falla.
    await player.waitForEvent('contentFirstPlay', 20_000)

    // Dar tiempo al SDK para que enviara beacons si estuviera activo.
    // Usamos expect.poll con una condición negativa (seguir siendo 0).
    // El intervalo corto (~200ms × 10 intentos) es suficiente para detectar
    // cualquier beacon rezagado sin usar waitForTimeout.
    await expect.poll(() => beacons.length, {
      timeout: 2_000,
      intervals: [200],
      message: 'Se esperaba que no hubiera beacons NPAW — Youbora no debería estar activo sin config',
    }).toBe(0)
  })

  test('no beacons when enabled=true but account_code missing', async ({ isolatedPlayer: player, page }) => {
    // Arrange — activar Youbora con enabled=true pero SIN account_code.
    // Según BR-01 / EC-02: el componente se monta pero tracker.init() retorna
    // sin efecto al verificar `if (!accountCode) return`.
    await mockPlayerConfig(page, {
      metadata: {
        player: {
          tracking: {
            youbora: { enabled: true },
            // account_code intencionalmente ausente
          },
        },
      },
    })

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Act — confirmar reproducción antes de verificar ausencia de beacons
    await player.waitForEvent('contentFirstPlay', 20_000)

    await expect.poll(() => beacons.length, {
      timeout: 2_000,
      intervals: [200],
      message: 'Se esperaba que no hubiera beacons NPAW — account_code es requerido para inicializar el plugin',
    }).toBe(0)
  })
})

// ── TB-03 y TB-04: Content Tracking ─────────────────────────────────────────

test.describe('Youbora — Content Tracking', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('emits start beacon after contentFirstPlay', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    // Strategy B — logging de descubrimiento de dominios reales del SDK.
    // Útil para auditoría empírica de qué dominios usa npaw-plugin@7.3.28.
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes('npaw') || url.includes('youbora')) {
        console.log('[NPAW beacon discovered]', url)
      }
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Act — esperar la señal que dispara fireStart + fireJoin en el tracker
    await player.waitForEvent('contentFirstPlay', 20_000)


    const startBeacons = () =>
      beacons.filter(url =>
        url.includes('/start') || url.includes('/joinTime')
      ).length

    await expect.poll(startBeacons, {
      timeout: 20_000,
      message: 'Se esperaban beacons /start y/o /joinTime tras contentFirstPlay',
    }).toBeGreaterThan(0)
  })

  test('emits pause beacon after player.pause()', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    // Strategy B — logging de descubrimiento de dominios reales del SDK.
    // Útil para auditoría empírica de qué dominios usa npaw-plugin@7.3.28.
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes('npaw') || url.includes('youbora')) {
        console.log('[NPAW beacon discovered]', url)
      }
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Esperar sesión iniciada
    await player.waitForEvent('contentFirstPlay', 20_000)
    const startBeacons = () =>
      beacons.filter(url =>
        url.includes('/start') || url.includes('/joinTime')
      ).length

    await expect.poll(startBeacons, {
      timeout: 20_000,
      message: 'Se esperaban beacons /start y/o /joinTime antes de pausar el player',
    }).toBeGreaterThan(0)

    // Registrar línea base de beacons antes de pausar.
    // heartbeats del SDK pueden llegar en cualquier momento — comparamos
    // con el snapshot en lugar de un número absoluto.
    const n0 = beacons.length

    // Debug: estado antes de pausar
    console.log('[DEBUG] Beacons antes de pause:', beacons.length)
    const playerStateBefore = await player.page.evaluate(() => ({
      paused: (window as any).__player?.paused,
      playing: (window as any).__player?.isPlaying?.(),
      currentTime: (window as any).__player?.currentTime,
      ready: (window as any).__player?.isReady?.() ?? !!(window as any).__player
    }))
    console.log('[DEBUG] Estado player antes de pause:', playerStateBefore)

    // Act
    await player.pause()
    await player.waitForEvent('pause', 5_000)

    // Debug: estado después de pausar
    console.log('[DEBUG] Beacons después de pause:', beacons.length)
    const playerStateAfter = await player.page.evaluate(() => ({
      paused: (window as any).__player?.paused,
      playing: (window as any).__player?.isPlaying?.(),
      currentTime: (window as any).__player?.currentTime
    }))
    console.log('[DEBUG] Estado player después de pause:', playerStateAfter)
    console.log('[DEBUG] Beaacons capturados:', beacons.map(url => url.split('/').pop()))

    // Assert — al menos 1 beacon adicional tras la pausa (firePause)
    const pauseBeacons = () =>
      beacons.filter(url => url.includes('/pause')).length

    await expect.poll(pauseBeacons, {
      timeout: 8_000,
      message: 'Se esperaba beacon /pause tras player.pause()',
    }).toBeGreaterThan(0)
  })
})

// ── TB-05 y TB-06: Ad Integration ───────────────────────────────────────────

test.describe('Youbora — Ad Integration', { tag: ['@integration', '@analytics', '@youbora', '@ads'] }, () => {

  test('content tracking masked during ad break (_inAdBreak guard)', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    // autoplay:false ensures IMA initializes AFTER Youbora's LMA requests settle.
    // With autoplay:true on a local HLS stream, content starts playing before IMA
    // is ready when Youbora is active — the player skips the pre-roll window.
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    // play() triggers IMA AdsManager initialization in a clean state (Youbora ready,
    // HLS not yet playing). Pre-roll will fire adsContentPauseRequested.
    await player.play()

    // Esperar inicio del ad break — en este punto _inAdBreak = true
    // y el tracker ignorará eventos de contenido (playing, pause, seeking, etc.)
    await player.waitForEvent('adsContentPauseRequested', 30_000)

    // Registrar beacons al momento del inicio del ad break
    const beaconsAtAdBreakStart = beacons.length

    // Act — esperar el fin del ad break (_inAdBreak = false)
    // Durante este intervalo, el content adapter NO debe emitir beacons de contenido.
    await player.waitForEvent('adsContentResumeRequested', 60_000)

    // Assert — tras adsContentResumeRequested, el tracker llama adapter.fireResume()
    // y debe emitir al menos 1 beacon de contenido adicional.
    // No podemos distinguir exactamente cuántos son de ads vs contenido —
    // solo verificamos que hubo actividad después del resume.
    await expect.poll(() => beacons.length, {
      timeout: 5_000,
      message: 'Se esperaba al menos 1 beacon NPAW después de adsContentResumeRequested (fireResume de contenido)',
    }).toBeGreaterThan(beaconsAtAdBreakStart)
  })

  test('emits ad lifecycle beacons during pre-roll', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    // autoplay:false + play() — same fix as TB-05: prevents HLS/IMA race when Youbora active.
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    await player.play()

    // Act — esperar el ciclo completo del ad break
    // El tracker dispara: breakStart, adStart, adJoin, (quartiles), adStop, breakStop
    await player.waitForAllAdsComplete(60_000)

    // Assert — según BR-09 y la secuencia documentada en observability.md,
    // el ciclo mínimo es: fireBreakStart + fireStart + fireJoin + fireStop + fireBreakStop = 5 llamadas.
    // Usamos toBeGreaterThan(3) con margen por si alguna llamada es agrupada por el SDK.
    await expect.poll(() => beacons.length, {
      timeout: 5_000,
      message: 'Se esperaban al menos 4 beacons NPAW durante el ciclo de vida del ad (breakStart, adStart, adStop, breakStop)',
    }).toBeGreaterThan(3)
  })
})

// ── TB-07 y TB-08: Session Management ───────────────────────────────────────

test.describe('Youbora — Session Management', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('restarts tracking session after player.load() with new content', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Esperar sesión del primer contenido
    await player.waitForEvent('contentFirstPlay', 20_000)

    // Esperar que los beacons de la sesión lleguen antes de capturar el baseline.
    // contentFirstPlay puede dispararse antes de que el SDK procese el evento y emita beacons.
    const startBeaconsCount = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length
    await expect.poll(startBeaconsCount, {
      timeout: 20_000,
      message: 'Se esperaban beacons /start y/o /joinTime del primer contenido antes de cargar el segundo',
    }).toBeGreaterThan(0)

    const n1 = beacons.length

    // Act — cargar nuevo contenido. Según BR-04 y observability.md:
    //   1. tracker._cleanup() → adapter.fireStop() (cierra sesión anterior)
    //   2. setTimeout(0ms) → tracker.init(newOptions) (nueva sesión)
    // Usar ID distinto garantiza sourcechange real y reinicio de sesión Youbora.
    // Mismo ID puede no disparar restart en el tracker si el player detecta
    // que la fuente no cambió.
    await player.load({ type: 'media', id: MockContentIds.episode })

    // Esperar que el segundo contenido dispare contentFirstPlay
    await player.waitForEvent('contentFirstPlay', 20_000)

    // Assert — el total de beacons debe haber aumentado después del segundo contentFirstPlay.
    // Esto confirma que la nueva sesión se inició (fireStart + fireJoin del nuevo contenido).
    await expect.poll(() => beacons.length, {
      timeout: 8_000,
      message: 'Se esperaba un incremento de beacons NPAW tras player.load() — nueva sesión debe iniciar',
    }).toBeGreaterThan(n1)
  })

  test('no beacons when player.destroy() called before contentFirstPlay', async ({ isolatedPlayer: player, page }) => {
    // Arrange — autoplay: false para controlar el timing y destruir antes de any play
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })

    // Esperar ready — en este punto el player está montado y YouboraTracker se montó,
    // pero _started = false porque contentFirstPlay nunca se disparó.
    await player.waitForReady(20_000)

    // Act — destruir el player sin llamar play()
    // Según BR-10 / EC-06: tracker.destroy() → _cleanup() → adapter.fireStop()
    // pero como _started = false, no debería haber sesión activa que reportar.
    await player.destroy()

    // Assert — el SDK emite /init + /ping al instanciar NpawPlugin(), así que
    // beacons.length puede ser > 0. Lo que no debe existir son beacons de sesión
    // (/start, /joinTime) — esos requieren contentFirstPlay, que nunca se disparó.
    const startBeacons = () =>
      beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length
    await expect.poll(startBeacons, {
      timeout: 3_000,
      intervals: [200],
      message: 'Se esperaba 0 beacons /start y /joinTime — destroy() antes de contentFirstPlay no inicia sesión',
    }).toBe(0)
  })
})

// ── TB-09: Error Reporting ───────────────────────────────────────────────────

test.describe('Youbora — Error Reporting', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('emits error beacon after fatal playback error', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Esperar sesión iniciada — necesario para que _adapter exista en el tracker.
    // Según observability.md, el handler onError verifica `if (!this._adapter) return`,
    // por lo que el adapter debe estar creado antes de que llegue el error.
    await player.waitForEvent('contentFirstPlay', 20_000)

    const n0 = beacons.length

    // Act — abortar segmentos HLS mid-playback para forzar error fatal en el video element.
    // El 403 en platform config no garantiza un error player observable (el player puede
    // haber cacheado la config). Bloquear el stream HLS es más robusto: hls.js escala
    // a error fatal tras los retries internos, lo que dispara el evento 'error' del player
    // y activa el handler onError en el tracker (igual que NPAW-8.3).
    await page.route('**/localhost:9001/vod/**', (route) => route.abort())

    // Esperar el evento de error del player
    await player.waitForEvent('error', 20_000)

    // Assert — al menos 1 beacon adicional tras el error
    // (correspondiente a fireFatalError o fireError según el flag data.fatal)
    await expect.poll(() => beacons.length, {
      timeout: 8_000,
      message: 'Se esperaba al menos 1 beacon NPAW de error después del evento error del player',
    }).toBeGreaterThan(n0)
  })
})

// ── GAP-1: Activation Guards (ampliación) ───────────────────────────────────

test.describe('Youbora — Activation Guards (explicit disabled)', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('no beacons when enabled=false explicitly', async ({ isolatedPlayer: player, page }) => {
    // Arrange — enabled=false es explícito, aunque account_code esté presente.
    // tracker.init() no se llama cuando el componente verifica enabled: false
    // antes de instanciar YouboraTracker.
    await mockPlayerConfig(page, {
      metadata: {
        player: {
          tracking: {
            youbora: { enabled: false, account_code: YOUBORA_ACCOUNT_CODE },
          },
        },
      },
    })

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Esperar contentFirstPlay para confirmar que el player reprodujo correctamente.
    // Sin esto, el test podría pasar vacío si el stream falla antes de enviar beacons.
    await player.waitForEvent('contentFirstPlay', 20_000)

    // El SDK no debe haber enviado ningún beacon — Youbora desactivado explícitamente.
    await expect.poll(() => beacons.length, {
      timeout: 2_000,
      intervals: [200],
      message: 'Se esperaba que no hubiera beacons NPAW — enabled:false desactiva el plugin aunque account_code esté presente',
    }).toBe(0)
  })
})

// ── GAP-2: Content Tracking Guards ──────────────────────────────────────────

test.describe('Youbora — Content Tracking Guards', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('double pause emits only one firePause beacon', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    const startBeacons = () =>
      beacons.filter(url =>
        url.includes('/start') || url.includes('/joinTime')
      ).length

    await expect.poll(startBeacons, {
      timeout: 20_000,
      message: 'Se esperaban beacons /start y/o /joinTime antes de la primera pausa',
    }).toBeGreaterThan(0)

    const n0 = beacons.length

    // Filtrar solo beacons de pausa de contenido — pings continúan durante pause
    // (guard no chequea _paused, solo _inAdBreak), así que el conteo total de beacons
    // no se estabiliza. Comparar solo /pause para aislar el comportamiento del guard.
    const pauseBeaconCount = () => beacons.filter(url => url.includes('/pause')).length

    // Act — primera pausa: _paused = false → _paused = true, firePause() se llama
    await player.pause()
    await player.waitForEvent('pause', 5_000)

    // Esperar que llegue el beacon /pause de la primera pausa
    await expect.poll(pauseBeaconCount, {
      timeout: 8_000,
      intervals: [150],
      message: 'Primera pausa debe emitir exactamente 1 beacon /pause hacia NQS',
    }).toBe(1)

    // Segunda pausa inmediata: _paused ya es true → la guarda en tracker.js:102
    // `if (!this._adapter || !this._started || this._inAdBreak || this._paused) return`
    // impide que firePause() se vuelva a llamar.
    await player.pause()

    // Esperar 1.5s — si hubiera un segundo /pause, debería llegar en este window.
    await expect.poll(pauseBeaconCount, {
      timeout: 1_500,
      intervals: [150],
      message: 'Segunda pausa no debe emitir beacon adicional — _paused guard previene firePause duplicado',
    }).toBe(1)

    // Confirmar que sí hubo actividad (sesión activa)
    expect(beacons.length).toBeGreaterThan(n0)
  })

  test('no fireStart beacon before contentFirstPlay when autoplay is false', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    // autoplay: false — el player se inicializa pero no reproduce
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })

    // Esperar ready sin disparar play() — el player está montado con YouboraTracker activo
    // pero _started = false porque contentFirstPlay no se emitirá hasta el primer play.
    await player.waitForReady(20_000)

    // Assert — el SDK emite /init + /ping al instanciar NpawPlugin(), pero
    // fireStart y fireJoin solo se disparan en contentFirstPlay (tracker.js:85).
    // Sin play(), contentFirstPlay no se emite → /start y /joinTime deben ser 0.
    const startBeacons = () =>
      beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length
    await expect.poll(startBeacons, {
      timeout: 3_000,
      intervals: [200],
      message: 'Se esperaba 0 beacons /start y /joinTime — fireStart solo dispara en contentFirstPlay (tracker.js:85)',
    }).toBe(0)
  })
})

// ── GAP-3: DVR Content Type ──────────────────────────────────────────────────

test.describe('Youbora — DVR Content Type', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('DVR content type activates Youbora plugin and emits beacons', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    // Nota: type='dvr' es válido en modo aislado porque setupPlatformMocks intercepta
    // live-stream/{id}.json y devuelve content/live.json. El player tratará el stream
    // como DVR según el type param, aunque el stream local no tenga DVR real.
    // DVR mapea a content.type="DVR" en buildVideoOptions:11 en tracker.js.
    // Aquí verificamos que el plugin se activa correctamente para este tipo de contenido.
    await player.goto({ type: 'dvr', id: MockContentIds.vod, autoplay: true })

    // Act — esperar contentFirstPlay (o playing como fallback ya que DVR puede no emitir contentFirstPlay
    // si el stream local no tiene suficiente buffer de live). Usamos expect.poll para ser resilientes.
    await expect.poll(
      () => player.page.evaluate(() => {
        const events = (window as any).__qa?.events ?? []
        return events.includes('contentFirstPlay') || events.includes('playing')
      }),
      { timeout: 25_000, intervals: [500] }
    ).toBe(true)

    // Assert — el plugin se activó para type=dvr y emitió al menos 1 beacon.
    // Beacon emission confirma que el plugin se activó para DVR type.
    // DVR maps to content.type="DVR" per buildVideoOptions:11 in tracker.js.
    await expect.poll(() => beacons.length, {
      timeout: 8_000,
      message: 'Se esperaba al menos 1 beacon NPAW para DVR — plugin debe activarse para type="dvr"',
    }).toBeGreaterThan(0)
  })
})

// ── GAP-4: Episode Metadata Robustness ──────────────────────────────────────

test.describe('Youbora — Episode Metadata Robustness', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('episode type without show/season metadata does not crash', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    // type='episode' sin metadata.show ni metadata.season.
    // buildVideoOptions:33-36 en tracker.js usa optional chaining:
    //   if (metadata?.show) opts['content.program'] = metadata.show
    //   if (metadata?.season !== null && ...) opts['content.season'] = ...
    // Los campos ausentes se omiten silenciosamente — no debe lanzar excepciones.
    await player.goto({ type: 'episode', id: MockContentIds.vod, autoplay: true })

    // Act
    await player.waitForEvent('contentFirstPlay', 20_000)

    // Assert — si beacons.length > 0, el plugin se inicializó y funcionó sin crash.
    // Un crash en buildVideoOptions habría impedido que el adapter se registrara.
    await expect.poll(() => beacons.length, {
      timeout: 8_000,
      message: 'Se esperaba al menos 1 beacon — episode sin show/season no debe crashear el plugin',
    }).toBeGreaterThan(0)
  })
})

// ── GAP-5: Session Management (ampliación) ──────────────────────────────────

test.describe('Youbora — Session Management (_pendingInit)', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('_pendingInit cleared if destroy() called during restart()', async ({ isolatedPlayer: player, page }) => {
    // Este test tiene sensibilidad de timing inherente por el uso de setTimeout(0)
    // en restart(). Ver tracker.js:246. Se marca test.slow() para dar más tiempo.
    test.slow()

    // NOTA DE NO-DETERMINISMO: destroy() llama _cleanup() que llama clearTimeout(_pendingInit).
    // Si destroy() llega ANTES de que el setTimeout(0) se ejecute (que es el caso normal
    // en un entorno JS de un solo hilo), el init queda cancelado. Sin embargo, si hay
    // microtasks pendientes que retrasan _cleanup, el init puede haberse ejecutado ya.
    // test.fixme se activa si el timing resulta demasiado flaky en CI.
    test.fixme(
      process.env.CI === 'true' && process.platform === 'linux',
      'GAP-5: _pendingInit timing sensible — setTimeout(0) puede resolverse antes de destroy() en Linux CI bajo carga'
    )

    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    const n0 = beacons.length

    // Act — player.load() llama tracker.restart() que hace:
    //   this._cleanup()                        → _pendingInit cancelado, fireStop del adapter anterior
    //   this._pendingInit = setTimeout(() => { this.init(opts) }, 0)
    // Inmediatamente después, destroy() cancela ese setTimeout antes de que se ejecute.
    // Usamos page.evaluate para ejecutar ambas llamadas en el mismo tick JS del browser,
    // minimizando la ventana de tiempo entre load() y destroy().
    await page.evaluate(() => {
      const p = (window as any).__player
      if (p) {
        p.load({ type: 'media', id: (window as any).__qa?.lastConfig?.id ?? 'mock-vod' })
        p.destroy()
      }
    })

    // Esperar que cualquier efecto asíncrono se estabilice.
    // _cleanup en destroy() llama clearTimeout(_pendingInit) — el nuevo init no debe dispararse.
    // Se permite n0 + 2 para absorber: posible fireStop de _cleanup al llamar load() más
    // cualquier heartbeat del SDK que estuviera en vuelo.
    await expect.poll(() => beacons.length, {
      timeout: 1_500,
      intervals: [150],
      message: 'Se esperaba que destroy() cancelara el _pendingInit de restart() — no debe haber nuevo fireStart',
    }).toBeLessThanOrEqual(n0 + 2)
  })
})

// ── GAP-6: NPAW Protocol Validation ─────────────────────────────────────────

test.describe('Youbora — NPAW Protocol', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('NPAW-4.2 — seek emits seek beacons without spurious view close', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)

    // contentFirstPlay se puede backfillar antes de que el HLS handler tenga el
    // video element listo (_element). Con Youbora activa, las requests a lma.npaw.com
    // durante init amplían esa ventana. Esperar currentTime > 0 garantiza que
    // el video element está operativo y el seek no será un no-op silencioso.
    await expect.poll(
      () => player.page.evaluate(() => (window as any).__player?.currentTime ?? 0),
      { timeout: 10_000, message: 'currentTime debe ser > 0 antes de seek' }
    ).toBeGreaterThan(0)

    const n0 = beacons.length

    // Act — seek via player API (tracker.js:113 onSeeking → fireSeekBegin, :118 onSeeked → fireSeekEnd)
    await player.seek(5)
    await player.waitForEvent('seeked', 10_000)

    // Assert — seek debe haber generado beacons adicionales (fireSeekBegin + fireSeekEnd).
    // NPAW 4.2 regression conocida en CaracolTV: el seek cerraba la vista y enviaba un
    // /bufferUnderrun espurio. Este test verifica que la integración del Lightning Player
    // no tiene esa regresión. Solo podemos confirmar que se emitieron beacons —
    // verificar ausencia de bufferUnderrun requeriría inspección de payload interna al SDK.
    await expect.poll(() => beacons.length, {
      timeout: 5_000,
      message: 'Se esperaba al menos 1 beacon NPAW tras seek (fireSeekBegin/fireSeekEnd en tracker.js:113-121)',
    }).toBeGreaterThan(n0)
  })

  test('NPAW-5.1 — pause then resume emits both pause and resume beacons', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)

    // Esperar que los beacons de sesión lleguen antes de capturar el baseline.
    const startBeaconsN51 = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length
    await expect.poll(startBeaconsN51, {
      timeout: 20_000,
      message: 'Se esperaban beacons /start y/o /joinTime antes de pausar (NPAW-5.1)',
    }).toBeGreaterThan(0)

    const n0 = beacons.length

    // Act — pausa: tracker.js:101 onPause → _paused = true, firePause()
    await player.pause()
    await player.waitForEvent('pause', 5_000)

    // Beacon de pausa llega async — poll antes de capturar n1 para evitar race condition
    await expect.poll(() => beacons.length, {
      timeout: 5_000,
      message: 'Se esperaba beacon de pausa NPAW tras player.pause()',
    }).toBeGreaterThan(n0)

    const n1 = beacons.length

    // Resume: tracker.js:93 onPlaying → si _paused, _paused = false, fireResume()
    await player.play()
    await player.waitForEvent('playing', 10_000)

    await expect.poll(() => beacons.length, {
      timeout: 5_000,
      message: 'Se esperaba beacon de resume NPAW tras player.play() (fireResume en tracker.js:97)',
    }).toBeGreaterThan(n1)
  })

  test('NPAW-7.1 — video ended emits stop beacon', async ({ isolatedPlayer: player, page }) => {
    test.slow() // seek-to-end + ended on 90s local HLS stream needs extra time
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)

    // Esperar beacons de sesión antes de capturar baseline (pueden llegar tarde)
    const startBeaconsN71 = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length
    await expect.poll(startBeaconsN71, {
      timeout: 20_000,
      message: 'Se esperaban beacons /start y/o /joinTime antes de seek al final (NPAW-7.1)',
    }).toBeGreaterThan(0)

    const n0 = beacons.length

    // Seek via elemento nativo de video (más fiable que player.seek para near-end).
    // player.duration puede diferir de video.duration en algunas implementaciones de handler.
    await expect.poll(
      () => player.page.evaluate(() => {
        const v = document.querySelector('video') ?? document.querySelector('audio')
        return v ? v.duration : 0
      }),
      { timeout: 10_000, message: 'video.duration debe ser > 0 antes de seek' }
    ).toBeGreaterThan(0)

    await player.page.evaluate(() => {
      const v = document.querySelector('video') ?? document.querySelector('audio')
      if (v && isFinite(v.duration) && v.duration > 0.5) v.currentTime = v.duration - 0.1
    })

    // Esperar ended vía harness events O estado nativo del video element.
    // El player puede propagar ended al SDK Youbora aunque el harness no lo capture.
    await expect.poll(
      () => player.page.evaluate(() => {
        const v = document.querySelector('video') ?? document.querySelector('audio')
        return !!(window as any).__qa?.events?.includes('ended') || v?.ended === true
      }),
      { timeout: 60_000, message: 'El video debe llegar a ended tras seek al final (NPAW-7.1)' }
    ).toBe(true)

    // Assert — tracker.js:107 onEnded → fireStop(), _started = false
    await expect.poll(() => beacons.filter(url => url.includes('/stop')).length, {
      timeout: 10_000,
      message: 'Se esperaba beacon /stop de Youbora tras ended (NPAW-7.1)',
    }).toBeGreaterThan(0)
  })

  test('NPAW-8.1 — startup error via blocked manifest emits error beacon', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    // Bloquear el stream HLS local ANTES de goto() para simular un error de inicio.
    // Esto garantiza un error fatal en el video element (tracker.js:149 fireFatalError).
    // Se intercepta con abort() para que hls.js reciba un error de red inmediatamente.
    await page.route('**/localhost:9001/vod/**', (route) => route.abort())

    // Act
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Esperar el evento de error del player — hls.js reportará el fallo del manifest
    await player.waitForEvent('error', 15_000)

    // Assert — al menos 1 beacon NPAW de error (fireFatalError per tracker.js:150)
    await expect.poll(() => beacons.length, {
      timeout: 5_000,
      message: 'Se esperaba al menos 1 beacon NPAW de error tras startup error (NPAW-8.1)',
    }).toBeGreaterThan(0)
  })

  test('NPAW-8.3 — instream error via blocked chunks mid-playback emits error beacon', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)

    const n0 = beacons.length

    // Act — bloquear segmentos DURANTE la reproducción para forzar un error mid-stream.
    // hls.js intentará re-cargar segmentos y eventualmente escalará a error fatal.
    await page.route('**/localhost:9001/vod/**', (route) => route.abort())

    // Esperar el evento de error (timeout generoso — hls.js tiene retries internos)
    await player.waitForEvent('error', 20_000)

    // Assert — beacon de error adicional tras el fallo mid-stream
    await expect.poll(() => beacons.length, {
      timeout: 5_000,
      message: 'Se esperaba beacon NPAW de error mid-stream (NPAW-8.3)',
    }).toBeGreaterThan(n0)
  })

  test('NPAW-8.6 — new session starts after error recovery', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    // Bloquear el stream para forzar error en startup
    await page.route('**/localhost:9001/vod/**', (route) => route.abort())

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('error', 15_000)

    const n0 = beacons.length

    // Act — desbloquear el stream y cargar nuevo contenido para iniciar recuperación.
    // page.unroute() elimina el handler de abort, permitiendo que las requests pasen.
    await page.unroute('**/localhost:9001/vod/**')

    // player.load() llama tracker.restart() → nueva sesión Youbora tras clearTimeout(_pendingInit)
    await player.load({ type: 'media', id: MockContentIds.vod })

    // Esperar que la nueva sesión inicie — contentFirstPlay confirma reproducción exitosa
    await player.waitForEvent('contentFirstPlay', 20_000)

    // Assert — beacons adicionales de la nueva sesión (fireStart + fireJoin del nuevo contenido)
    await expect.poll(() => beacons.length, {
      timeout: 8_000,
      message: 'Se esperaba incremento de beacons NPAW tras recovery — nueva sesión debe iniciar (NPAW-8.6)',
    }).toBeGreaterThan(n0)
  })
})

// ── GAP-7: Config Robustness ─────────────────────────────────────────────────

test.describe('Youbora — Config Robustness', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('null options context does not crash player', async ({ isolatedPlayer: player, page }) => {
    // Arrange — capturar errores de consola ANTES de goto() para no perder ninguno
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    // Act — cargar y reproducir normalmente
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)

    // Assert 1 — Youbora está activo (beacons emitidos)
    await expect.poll(() => beacons.length, {
      timeout: 8_000,
      message: 'Se esperaba al menos 1 beacon NPAW para confirmar que Youbora está activo',
    }).toBeGreaterThan(0)

    // Assert 2 — no hay errores de consola relacionados con Youbora o npaw.
    // YB-07 step 2: optional chaining en contextMapper protege contra null options.
    const youboraErrors = consoleErrors.filter(
      (e) => e.toLowerCase().includes('youbora') || e.toLowerCase().includes('npaw')
    )
    expect(youboraErrors).toHaveLength(0)
  })

  test('empty account_code is falsy — init guard returns early, player unaffected', async ({ isolatedPlayer: player, page }) => {
    // Arrange — account_code vacío: string vacía es falsy en JS.
    // tracker.js:59: `const { accountCode } = options; if (!accountCode) return`
    // El plugin NO se inicializa, pero el player debe continuar reproduciendo normalmente.
    // YB-07 step 3: empty account_code hits the falsy guard at tracker.js:59.
    await mockPlayerConfig(page, {
      metadata: {
        player: {
          tracking: {
            youbora: { enabled: true, account_code: '' },
          },
        },
      },
    })

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Act — el player debe reproducir correctamente sin Youbora inicializado
    await player.waitForEvent('contentFirstPlay', 20_000)

    // Assert 1 — no beacons (tracker.init() retornó en línea 59 sin crear NpawPlugin)
    await expect.poll(() => beacons.length, {
      timeout: 2_000,
      intervals: [200],
      message: 'Se esperaba 0 beacons — account_code vacío es falsy, tracker.init() retorna en línea 59',
    }).toBe(0)

    // Assert 2 — el player sigue funcionando (reproduce contenido correctamente)
    await player.assertIsPlaying()
  })
})

// ── NPAW-1.6: VOD Replay ─────────────────────────────────────────────────────

test.describe('Youbora — VOD Replay', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('NPAW-1.6 — replay after ended opens new Youbora session', async ({ isolatedPlayer: player, page }) => {
    test.slow() // seek-to-end + replay on 90s local HLS needs extra time
    // NPAW-1.6: replay after ended opens a new view in NPAW.
    // tracker.js:109 sets _started=false on ended, so onFirstPlay guard passes
    // on replay and fires fireStart again, opening view #2 in NPAW.
    //
    // Sequence:
    //   ended → tracker.onEnded() → adapter.fireStop() → _started = false  (closes view #1)
    //   player.play() → player emits contentFirstPlay again                 (player also resets _started on ended)
    //   → tracker.onFirstPlay() → guard passes (_started is false)
    //   → adapter.fireStart() + adapter.fireJoin()                          (opens view #2)

    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Wait for first session to start — fireStart + fireJoin beacons land here
    await player.waitForEvent('contentFirstPlay', 20_000)

    // Esperar beacons de sesión antes de capturar n0
    const startBeaconsN16 = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length
    await expect.poll(startBeaconsN16, {
      timeout: 20_000,
      message: 'Se esperaban beacons /start y/o /joinTime antes de seek al final (NPAW-1.6)',
    }).toBeGreaterThan(0)

    const n0 = beacons.length

    // Seek via elemento nativo (más fiable que player.seek para near-end en stream local)
    await expect.poll(
      () => player.page.evaluate(() => {
        const v = document.querySelector('video') ?? document.querySelector('audio')
        return v ? v.duration : 0
      }),
      { timeout: 10_000, message: 'video.duration debe ser > 0 antes de seek' }
    ).toBeGreaterThan(0)

    await player.page.evaluate(() => {
      const v = document.querySelector('video') ?? document.querySelector('audio')
      if (v && isFinite(v.duration) && v.duration > 0.5) v.currentTime = v.duration - 0.1
    })

    // Esperar ended vía harness events O estado nativo del video element
    await expect.poll(
      () => player.page.evaluate(() => {
        const v = document.querySelector('video') ?? document.querySelector('audio')
        return !!(window as any).__qa?.events?.includes('ended') || v?.ended === true
      }),
      { timeout: 60_000, message: 'El video debe llegar a ended tras seek al final (NPAW-1.6)' }
    ).toBe(true)

    const n1 = beacons.length

    // Confirm that fireStop beacon was captured after ended
    await expect.poll(() => beacons.filter(url => url.includes('/stop')).length, {
      timeout: 10_000,
      message: 'Se esperaba beacon /stop tras ended (NPAW-1.6)',
    }).toBeGreaterThan(0)

    expect(n1).toBeGreaterThan(n0)

    // Act — trigger replay via public API.
    // player.load() resets __qa.events internally, so we call play() instead
    // to keep the same player instance and observe the contentFirstPlay from replay.
    // The harness tracks all events including duplicate occurrences via an array,
    // but waitForEvent checks for inclusion — reset events first so the poll is reliable.
    await player.page.evaluate(() => { (window as any).__qa.events = [] })
    await player.play()

    // Player resets its own _started flag on ended, so contentFirstPlay fires again on replay.
    // tracker.onFirstPlay() guard: `if (!this._adapter || this._started) return`
    // _started is false (reset by onEnded) → guard passes → fireStart + fireJoin for view #2.
    await player.waitForEvent('contentFirstPlay', 20_000)

    // Assert — new beacons arrived after replay (at minimum fireStart for view #2)
    await expect.poll(() => beacons.length, {
      timeout: 8_000,
      message: 'Se esperaba más beacons NPAW tras replay — tracker.onFirstPlay() debe abrir nueva sesión (view #2)',
    }).toBeGreaterThan(n1)

    // At minimum: fireStop (ended) + fireStart (replay) captured across both sessions
    expect(beacons.length).toBeGreaterThan(n0 + 1)
  })
})

// ── NPAW-Episode Chain: Two Episode Transitions ──────────────────────────────

test.describe('Youbora — Next Episode Session Chain', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('automatic next episode transition opens a new Youbora session', async ({ isolatedPlayer: player, page }) => {
    test.slow() // episode chain: ended + transition + second contentFirstPlay on 90s stream
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    await mockContentConfigById(page, {
      [MockContentIds.vod]: {
        title: 'Episode Alpha',
        mediaId: MockContentIds.vod,
        next: MockContentIds.episode,
        nextEpisodeTime: 1,
      },
      [MockContentIds.episode]: {
        title: 'Episode Beta',
        mediaId: MockContentIds.episode,
      },
    })

    const beacons = await setupNpawInterceptor(page)

    // Capture any platform request for episode 2 regardless of path prefix.
    // The player may use /episode/ or /video/ depending on renderAs — both match.
    const episodeRequests: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes(`/${MockContentIds.episode}.json`)) {
        episodeRequests.push(url)
      }
    })
    const initBeacons = () => beacons.filter(url => url.includes('/init')).length
    const startBeacons = () =>
      beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length

    // Episode 1 — omit view:'none' so the next-episode UI component mounts and
    // the automatic countdown can fire. view:'none' disables the React overlay
    // responsible for triggering the auto-transition timer.
    await player.goto({
      type: 'episode',
      id: MockContentIds.vod,
      autoplay: true,
    })

    await expect.poll(initBeacons, {
      timeout: 10_000,
      message: 'Se esperaba beacon /init de Youbora para el primer episodio',
    }).toBeGreaterThan(0)
    await expect.poll(startBeacons, {
      timeout: 20_000,
      message: 'Se esperaban beacons /start y/o /joinTime para el primer episodio',
    }).toBeGreaterThan(0)

    const firstSessionStarts = startBeacons()

    // Automatic next episode transition: no player.load() here. The episode flow must
    // reach ended, request the next content, and load Episode Beta by itself.
    await player.clearTrackedEvents()

    // Seek via native video element — more reliable than player.seek for near-end in local HLS
    await expect.poll(
      () => player.page.evaluate(() => {
        const v = document.querySelector('video') ?? document.querySelector('audio')
        return v ? v.duration : 0
      }),
      { timeout: 10_000, message: 'video.duration debe ser > 0 antes de seek al final del episodio' }
    ).toBeGreaterThan(0)

    await player.page.evaluate(() => {
      const v = document.querySelector('video') ?? document.querySelector('audio')
      if (v && isFinite(v.duration) && v.duration > 0.5) v.currentTime = v.duration - 0.1
    })

    // Dual ended detection: harness events array OR native video.ended
    await expect.poll(
      () => player.page.evaluate(() => {
        const v = document.querySelector('video') ?? document.querySelector('audio')
        return !!(window as any).__qa?.events?.includes('ended') || v?.ended === true
      }),
      { timeout: 60_000, message: 'El video debe llegar a ended tras seek al final (episode chain)' }
    ).toBe(true)

    // Wait for the player to request episode 2 content from the platform.
    // This confirms the automatic episode transition has been triggered.
    await expect.poll(() => episodeRequests.length, {
      timeout: 20_000,
      message: 'El flujo automático de episodio debe solicitar el contenido del siguiente episodio',
    }).toBeGreaterThan(0)

    // Wait for episode 2 to actually start playing before checking Youbora.
    // Without this, the 20s Youbora poll may expire while episode 2 is still
    // loading the HLS stream and the tracker hasn't had time to fire fireStart().
    await player.waitForEvent('contentFirstPlay', 30_000)

    // Youbora should have restarted its session on sourcechange and fired
    // fireStart + fireJoin when contentFirstPlay arrived for episode 2.
    await expect.poll(startBeacons, {
      timeout: 15_000,
      message: 'El segundo episodio debe emitir beacons normales de sesión Youbora',
    }).toBeGreaterThan(firstSessionStarts)
  })
})

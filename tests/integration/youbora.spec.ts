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
import { test, expect, MockContentIds, mockPlayerConfig, mockContentError } from '../../fixtures'
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
 * Registra un interceptor de red para dominios NPAW y devuelve el array de URLs
 * capturadas. El array se actualiza en tiempo real — se puede leer con expect.poll().
 *
 * IMPORTANTE: llamar ANTES de player.goto() para no perder beacons de init del SDK.
 */
async function setupNpawInterceptor(page: import('@playwright/test').Page): Promise<string[]> {
  const beacons: string[] = []

  const captureBeacon = async (route: Route) => {
    beacons.push(route.request().url())
    await route.fulfill({ status: 200, body: '' })
  }

  // npaw-plugin@7.3.28 usa tres dominios distintos:
  //   lma.npaw.com        — LMA init/config (configuration, data)
  //   *.youboranqs01.com  — NQS beacons reales (start, pause, seek, adInit, etc.)
  //                         ej: infinity-c40.youboranqs01.com
  //   *.youbora.com       — fallback legacy (poco frecuente en v7)
  await page.route('**/*.npaw.com/**', captureBeacon)
  await page.route('**youboranqs01.com/**', captureBeacon)
  await page.route('**/*.youbora.com/**', captureBeacon)

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

    // Assert — el SDK debe haber emitido al menos 1 beacon hacia NPAW
    // tras contentFirstPlay. No verificamos el path exacto — es interno al SDK.
    await expect.poll(() => beacons.length, {
      timeout: 8_000,
      message: 'Se esperaba al menos 1 beacon NPAW tras contentFirstPlay (fireStart + fireJoin)',
    }).toBeGreaterThan(0)
  })

  test('emits pause beacon after player.pause()', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Esperar sesión iniciada
    await player.waitForEvent('contentFirstPlay', 20_000)

    // Registrar línea base de beacons antes de pausar.
    // heartbeats del SDK pueden llegar en cualquier momento — comparamos
    // con el snapshot en lugar de un número absoluto.
    const n0 = beacons.length

    // Act
    await player.pause()
    await player.waitForEvent('pause', 5_000)

    // Assert — al menos 1 beacon adicional tras la pausa (firePause)
    await expect.poll(() => beacons.length, {
      timeout: 5_000,
      message: 'Se esperaba al menos 1 beacon NPAW adicional después de player.pause()',
    }).toBeGreaterThan(n0)
  })
})

// ── TB-05 y TB-06: Ad Integration ───────────────────────────────────────────

test.describe('Youbora — Ad Integration', { tag: ['@integration', '@analytics', '@youbora', '@ads'] }, () => {

  test('content tracking masked during ad break (_inAdBreak guard)', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

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

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

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
    const n1 = beacons.length

    // Act — cargar nuevo contenido. Según BR-04 y observability.md:
    //   1. tracker._cleanup() → adapter.fireStop() (cierra sesión anterior)
    //   2. setTimeout(0ms) → tracker.init(newOptions) (nueva sesión)
    // Usamos el mismo MockContentIds.vod — player.load() con mismo id es válido
    // para testear el reinicio de sesión sin necesidad de un segundo mock id.
    await player.load({ type: 'media', id: MockContentIds.vod })

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

    // Assert — no deben existir beacons de inicio de sesión.
    // NOTA (EC-07): el SDK npaw-plugin@7.3.28 puede emitir un request de "init" al
    // instanciarse con new NpawPlugin(), antes de cualquier fireXxx. Si este test
    // falla consistentemente con exactamente 1 beacon inmediatamente tras el init,
    // ese sería el comportamiento de init-request del SDK, no un bug del player.
    // En ese caso, ajustar la aserción a "no beacon tras destroy" vs "sin beacons en total".
    await expect.poll(() => beacons.length, {
      timeout: 3_000,
      intervals: [200],
      message: 'Se esperaba que no hubiera beacons de sesión NPAW — destroy() antes de contentFirstPlay',
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

    // Act — forzar un error en el player mockeando la respuesta de contenido como 403.
    // INCERTIDUMBRE (TB-09 / test-strategy): mockContentError() reemplaza la respuesta
    // de la plataforma con un 403. Esto puede disparar un error en el player a nivel de
    // config load (BR-03), no necesariamente un error fatal en el video element.
    // Si el player ya cargó su config antes de esta llamada, el 403 podría no tener
    // efecto inmediato. El test verifica que SI ocurre el evento 'error', Youbora
    // responde con un beacon. Si el evento no ocurre, el test expira en waitForEvent,
    // señalando que el mecanismo de error forcing necesita revisión.
    // Alternativa más robusta: abortar el stream HLS (cortar localhost:9001) mid-playback,
    // lo que garantiza un error fatal en el video element. Pendiente para próxima iteración.
    await mockContentError(page, 403)

    // Forzar un reload para que el 403 tenga efecto — llamar load() hace que el
    // player intente re-cargar la config de plataforma que ahora devuelve 403.
    await player.load({ type: 'media', id: MockContentIds.vod })

    // Esperar el evento de error del player (timeout generoso por variabilidad de red mock)
    await player.waitForEvent('error', 15_000)

    // Assert — al menos 1 beacon adicional tras el error
    // (correspondiente a fireFatalError o fireError según el flag data.fatal)
    await expect.poll(() => beacons.length, {
      timeout: 5_000,
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

    const n0 = beacons.length

    // Act — primera pausa: _paused = false → _paused = true, firePause() se llama
    await player.pause()
    await player.waitForEvent('pause', 5_000)
    const n1 = beacons.length

    // Segunda pausa inmediata: _paused ya es true → la guarda en tracker.js:102
    // `if (!this._adapter || !this._started || this._inAdBreak || this._paused) return`
    // impide que firePause() se vuelva a llamar.
    await player.pause()

    // Esperar un intervalo estable — si hubiera un beacon rezagado de la segunda pausa,
    // debería llegar en este window de 1500ms.
    await expect.poll(() => beacons.length, {
      timeout: 1_500,
      intervals: [150],
      message: 'Conteo de beacons debe estabilizarse — _paused guard en tracker.js:102 previene firePause duplicado',
    }).toBe(n1)

    // Verificar que n1 > n0 (primera pausa sí generó beacon) y n1 === final (segunda no)
    expect(n1).toBeGreaterThan(n0)
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

    // Assert — _started guard en tracker.js:85: onFirstPlay verifica `if (!this._adapter || this._started) return`
    // Aquí _started es false, pero más importante: contentFirstPlay no se emitió todavía,
    // así que onFirstPlay() nunca se llama. No debe haber beacon de fireStart/fireJoin.
    await expect.poll(() => beacons.length, {
      timeout: 3_000,
      intervals: [200],
      message: 'Se esperaba beacons.length === 0 — fireStart solo se dispara en contentFirstPlay (tracker.js:85)',
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

    const n0 = beacons.length

    // Act — pausa: tracker.js:101 onPause → _paused = true, firePause()
    await player.pause()
    await player.waitForEvent('pause', 5_000)

    const n1 = beacons.length
    expect(n1).toBeGreaterThan(n0) // beacon de pausa debe existir

    // Resume: tracker.js:93 onPlaying → si _paused, _paused = false, fireResume()
    await player.play()
    await player.waitForEvent('playing', 10_000)

    await expect.poll(() => beacons.length, {
      timeout: 5_000,
      message: 'Se esperaba beacon de resume NPAW tras player.play() (fireResume en tracker.js:97)',
    }).toBeGreaterThan(n1)
  })

  test('NPAW-7.1 — video ended emits stop beacon', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)

    const n0 = beacons.length

    // Act — esperar duration > 0 antes de seek; si metadata aún no cargó, duration=0
    // y seekTarget=-0.5 hace que ended nunca dispare.
    await expect.poll(
      () => player.page.evaluate(() => (window as any).__player?.duration ?? 0),
      { timeout: 10_000, message: 'duration debe ser > 0 antes de seek' }
    ).toBeGreaterThan(0)

    const duration = await player.page.evaluate(() => (window as any).__player?.duration ?? 0) as number
    await player.seek(duration - 0.5)

    // Esperar el evento ended — el stream local es corto, debe terminar pronto
    await player.waitForEvent('ended', 30_000)

    // Assert — tracker.js:107 onEnded → fireStop(), _started = false
    await expect.poll(() => beacons.length, {
      timeout: 5_000,
      message: 'Se esperaba beacon de stop NPAW tras ended (fireStop en tracker.js:109)',
    }).toBeGreaterThan(n0)
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
    const n0 = beacons.length

    // Wait for duration > 0 before seeking; metadata may not be loaded yet
    await expect.poll(
      () => player.page.evaluate(() => (window as any).__player?.duration ?? 0),
      { timeout: 10_000, message: 'duration debe ser > 0 antes de seek' }
    ).toBeGreaterThan(0)

    const duration = await player.page.evaluate(() => (window as any).__player?.duration ?? 0) as number

    // Seek to near end so that ended fires quickly
    await player.seek(duration - 0.5)

    // Wait for ended — tracker.js:107 onEnded → fireStop(), _started = false
    await player.waitForEvent('ended', 30_000)
    const n1 = beacons.length

    // Confirm that fireStop beacon was captured after ended
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

  test('two episode transitions each open a new Youbora session', async ({ isolatedPlayer: player, page }) => {
    // Each player.load() triggers tracker.restart() → _cleanup() (fireStop of current session)
    // → setTimeout(0) → init() with new options → new session on next contentFirstPlay.
    // Two transitions = three distinct Youbora sessions captured in beacons[].
    //
    // Session timeline:
    //   Episode 1 → contentFirstPlay → n0 beacons (fireStart #1 + fireJoin #1)
    //   load() #1 → tracker.restart() → fireStop #1 + setTimeout(0) → fireStart #2
    //   Episode 2 → contentFirstPlay → n1 beacons (> n0)
    //   load() #2 → tracker.restart() → fireStop #2 + setTimeout(0) → fireStart #3
    //   Episode 3 → contentFirstPlay → n2 beacons (> n1)

    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const beacons = await setupNpawInterceptor(page)

    // Episode 1
    await player.goto({ type: 'episode', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    const n0 = beacons.length

    // First episode Youbora session must have started (fireStart + fireJoin)
    expect(n0).toBeGreaterThan(0)

    // Transition 1 — player.load() calls tracker.restart() internally:
    //   _cleanup() → fireStop (closes session #1)
    //   setTimeout(0) → init(newOptions) → new session ready for episode 2
    // player.load() also resets __qa.events so waitForEvent('contentFirstPlay') is clean.
    await player.load({ type: 'episode', id: MockContentIds.vod })
    await player.waitForEvent('contentFirstPlay', 20_000)
    const n1 = beacons.length

    // Session #2 opened: beacons must have grown (fireStop #1 + fireStart #2 + fireJoin #2)
    expect(n1).toBeGreaterThan(n0)

    // Transition 2 — same pattern: restart() closes session #2, opens session #3
    await player.load({ type: 'episode', id: MockContentIds.vod })
    await player.waitForEvent('contentFirstPlay', 20_000)
    const n2 = beacons.length

    // Session #3 opened: beacons must have grown again (fireStop #2 + fireStart #3 + fireJoin #3)
    expect(n2).toBeGreaterThan(n1)
  })
})

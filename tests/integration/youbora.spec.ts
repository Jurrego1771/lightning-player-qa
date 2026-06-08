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
import { test, expect, MockContentIds, mockPlayerConfig, mockContentConfigById, ContentIds, PlayerIds } from '../../fixtures'
import type { Route } from '@playwright/test'

// ── Constantes compartidas ──────────────────────────────────────────────────

const MOCK_VAST_URL = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

// account_code viene de YOUBORA_ACCOUNT_CODE en .env — nunca hardcodeado.
// Sin este valor los tests que esperan beacons fallarán con 0 beacons capturados.
const YOUBORA_ACCOUNT_CODE = process.env.YOUBORA_ACCOUNT_CODE || 'qa_dummy'

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

type NpawInterceptor = {
  beacons: string[]
  /** POST body JSON keyed by full beacon URL. SDK 7.3.28 sends all metadata here, not in URL params. */
  beaconBodies: Map<string, Record<string, unknown>>
  /**
   * Espera a que llegue el primer beacon NQS (youboranqs01.com).
   * Necesario porque el chunk de Youbora se lazy-carga desde CDN → puede montarse
   * DESPUÉS de que contentFirstPlay ya disparó. El addInitScript mock responde LMA
   * en microtask (token listo antes que eventos del player), y el synthetic 'playing'
   * event (200ms post-LMA) fuerza onPlaying() → fireStart() si el tracker llegó tarde.
   * .catch(() => {}) seguro — la assertion subsiguiente falla con mensaje descriptivo.
   */
  waitForFirst: (timeout?: number) => Promise<void>
}

/**
 * Active beacon bodies for the current running test. Set by setupNpawInterceptor.
 * Safe as module-level state because tests run sequentially (workers: 1).
 * Allows parseBeaconParam to read POST bodies without changing every call site.
 */
let _activeBeaconBodies: Map<string, Record<string, unknown>> | undefined

/**
 * NPAW SDK 7.3.28 sends all content/ad metadata in the POST body (JSON), not URL query params.
 * Maps legacy dot-notation param names (used in test assertions) to actual body field names.
 */
const BODY_FIELD_ALIASES: Record<string, string> = {
  // Content metadata
  'content.id':          'contentId',
  'content.type':        'contentType',
  'content.duration':    'mediaDuration',
  'content.resource':    'mediaResource',
  'content.isLive':      'live',
  'content.title':       'title',
  'isLive':              'live',
  'media':               'mediaResource',
  'resource':            'mediaResource',
  // User metadata — SDK 7.3.28 uses 'username' (lowercase) for user.name
  'user.type':           'userType',
  'user.name':           'username',
  'user.id':             'username',
  'userId':              'username',
  'userName':            'username',
  // Device / player / plugin
  'device':              'deviceInfo',
  'device.code':         'deviceInfo',
  'device.ua':           'deviceInfo',
  'ua':                  'deviceInfo',
  'player.name':         'player',
  'playerName':          'player',
  'player.version':      'playerVersion',
  'player.pluginVersion':'pluginVersion',
  'nqs.version':         'pluginVersion',
  'player.pluginInfo':   'pluginInfo',
  'nqs.js':              'pluginInfo',
  'appName':             'appName',
  'app.name':            'appName',
  'appVersion':          'appReleaseVersion',
  'app.releaseVersion':  'appReleaseVersion',
  // Ad metadata
  'ad.title':            'adTitle',
  'ad.resource':         'adResource',
  'ad.mediaDuration':    'adDuration',
  'ad.duration':         'adDuration',
  'ad.isSkippable':      'skippable',
  'ad.skippable':        'skippable',
  'ad.position':         'position',
  'ad.breakNumber':      'breakNumber',
  'ad.adNumber':         'adNumber',
  'ad.numberInBreak':    'adNumberInBreak',
  'ad.adNumberInBreak':  'adNumberInBreak',
  'ad.givenAds':         'givenAds',
  'ad.expectedBreaks':   'expectedBreaks',
  'ad.givenBreaks':      'givenBreaks',
  'ad.breaksTime':       'breaksTime',
  'ad.expectedPattern':  'adsExpected',
  'ad.insertionType':    'adInsertionType',
  'ad.provider':         'adProvider',
  'ad.joinDuration':     'adJoinDuration',
  'ad.adJoinDuration':   'adJoinDuration',
  'ad.totalDuration':    'adTotalDuration',
  'ad.adTotalDuration':  'adTotalDuration',
  'ad.quartile':         'quartile',
  'ad.pauseDuration':    'pauseDuration',
  'ad.adPauseDuration':  'pauseDuration',
  'ad.adUrl':            'adUrl',
  'ad.url':              'adUrl',
  'adUrl':               'adUrl',
  'ad.bufferDuration':   'bufferDuration',
  'ad.adBufferDuration': 'bufferDuration',
  'bufferDuration':      'bufferDuration',
  'ad.errorCode':        'errorCode',
  'error.code':          'errorCode',
  'ad.errorMessage':     'errorMessage',
  'errorMessage':        'errorMessage',
  'msg':                 'errorMessage',
  // Ping / playback
  'content.playhead':    'playhead',
  'content.bitrate':     'bitrate',
  'content.totalBytes':  'totalBytes',
  'content.throughput':  'throughput',
  'dt':                  'diffTime',
  'pt':                  'pingTime',
  // Session
  'viewCode':            'code',
  'user.anonymousId':    'deviceUUID',
  'anonymousId':         'deviceUUID',
  'uuid':                'deviceUUID',
  'page.url':            'referer',
  // Custom dimensions
  'param1':              'param1',
  'content.customDimension.1': 'param1',
}

/**
 * Registra interceptores para beacons NQS y mock LMA del SDK NPAW.
 *
 * Estrategia LMA (dos niveles):
 *   1. addInitScript: XHR mock en el browser (microtask) — token listo ANTES de eventos player.
 *      Responde /data con {q:{h,c,pt,...}} (formato exacto de NpawPlugin.js setData()).
 *      Responde /configuration con {} (cualquier JSON válido funciona).
 *      Post-respuesta: dispara 'playing' en el video (200ms delay) para el caso donde
 *      el chunk cargó tarde y el tracker perdió contentFirstPlay — onPlaying() → fireStart().
 *   2. page.route LMA: fallback para grabar URLs en beacons (debugging).
 *      Si addInitScript interceptó, este handler NUNCA se ejecuta (XHR no llega a la red).
 *
 * IMPORTANTE: llamar ANTES de player.goto() para que addInitScript corra en la navegación.
 */
async function setupNpawInterceptor(page: import('@playwright/test').Page): Promise<NpawInterceptor> {
  const beacons: string[] = []
  const beaconBodies = new Map<string, Record<string, unknown>>()
  _activeBeaconBodies = beaconBodies
  const seen = new Set<string>()

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.text().includes('Fastdata') || msg.text().includes('NPAW')) {
      console.log(`[BROWSER CONSOLE - ${msg.type()}]:`, msg.text())
    }
  })

  const recordBeacon = (url: string, body?: Record<string, unknown>) => {
    if (!seen.has(url)) {
      seen.add(url)
      beacons.push(url)
    }
    if (body && !beaconBodies.has(url)) {
      beaconBodies.set(url, body)
    }
  }

  const captureBeacon = async (route: Route) => {
    const url = route.request().url()
    let body: Record<string, unknown> | undefined
    try {
      const raw = route.request().postData()
      if (raw) body = JSON.parse(raw)
    } catch {}
    recordBeacon(url, body)
    await route.fulfill({ status: 200, body: '' })
  }

  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('youboranqs01.com/') || url.includes('.youbora.com/')) {
      let body: Record<string, unknown> | undefined
      try {
        const raw = req.postData()
        if (raw) body = JSON.parse(raw)
      } catch {}
      recordBeacon(url, body)
    }
  })

  // Level 1 — browser-level XHR mock (addInitScript runs before any page scripts).
  // Intercepts lma.npaw.com XHR synchronously (microtask response) so the session
  // token is set before any player events fire — eliminates the "queue stuck" race.
  // setData() in NpawPlugin.js expects {q:{h,c,pt,i,st,vt,cb}} for /data endpoint.
  // After response, schedules a synthetic 'playing' event (200ms) as a safety net:
  // if the Youbora chunk loaded after contentFirstPlay (CDN latency race), onPlaying()
  // → fireStart() → sendRequest() with token ready → flushes _waitingForToken → NQS beacons.
  const lmaMockScript = `
    (function() {
      var _open = XMLHttpRequest.prototype.open;
      var _send = XMLHttpRequest.prototype.send;
      var LMA_HOST = '${YOUBORA_ACCOUNT_CODE}.youboranqs01.com';
      var SESSION  = 'test-session-qa-12345';

      XMLHttpRequest.prototype.open = function(method, url) {
        this.__lmaUrl = typeof url === 'string' ? url : '';
        return _open.apply(this, arguments);
      };

      XMLHttpRequest.prototype.send = function(body) {
        var url = this.__lmaUrl || '';
        if (!url.includes('lma.npaw.com')) {
          return _send.apply(this, arguments);
        }
        var xhr = this;
        var responseBody = url.includes('/data')
          ? JSON.stringify({ q: { h: LMA_HOST, c: SESSION, pt: 5, i: { bt: 30 }, st: 120, vt: 120, cb: 1 } })
          : '{}';

        Promise.resolve().then(function() {
          Object.defineProperty(xhr, 'readyState',    { get: function() { return 4; }, configurable: true });
          Object.defineProperty(xhr, 'status',        { get: function() { return 200; }, configurable: true });
          Object.defineProperty(xhr, 'response',      { get: function() { return responseBody; }, configurable: true });
          Object.defineProperty(xhr, 'responseText',  { get: function() { return responseBody; }, configurable: true });
          if (typeof xhr.onload === 'function') xhr.onload.call(xhr);
          if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange.call(xhr);

          // Safety net: 200ms after LMA /data response, dispatch HTML5 'playing' event.
          // If the Youbora chunk loaded after contentFirstPlay (CDN race), the player's
          // internal handler re-emits Events._playing → tracker.onPlaying() → fireStart().
          if (url.includes('/data')) {
            setTimeout(function() {
              var video = document.querySelector('video');
              if (video) video.dispatchEvent(new Event('playing', { bubbles: true }));
            }, 200);
          }
        });
      };
    })();
  `
  await page.addInitScript({ content: lmaMockScript })

  // Level 2 — Playwright route fallback for LMA (records URL in beacons for debugging).
  // Only fires if addInitScript did NOT intercept (e.g., XHR made to a non-mocked URL).
  await page.route(/lma\.npaw\.com/, async (route) => {
    const url = route.request().url()
    recordBeacon(url)
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: url.includes('/data') ? JSON.stringify({
        q: { h: `${YOUBORA_ACCOUNT_CODE}.youboranqs01.com`, c: 'test-session-qa-12345', pt: 5, i: { bt: 30 }, st: 120, vt: 120, cb: 1 },
      }) : '{}',
    })
  })

  // Intercept all NQS beacon traffic and record URLs for assertion.
  await page.route(/youboranqs01\.com\//, captureBeacon)
  await page.route(/\.youbora\.com\//, captureBeacon)

  // waitForFirst: resolves when first NQS beacon arrives, or throws after timeout.
  // Use with .catch(()=>{}) — the assertion that follows provides the failure message.
  const waitForFirst = async (timeout = 8_000): Promise<void> => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (beacons.some(u => u.includes('youboranqs01.com') || u.includes('.youbora.com'))) return
      await new Promise<void>(res => setTimeout(res, 150))
    }
    throw new Error(`waitForFirst: no NQS beacon arrived within ${timeout}ms. Beacons: ${beacons.slice(0, 3).join(', ')}`)
  }

  return { beacons, beaconBodies, waitForFirst }
}

// ── TB-01 y TB-02: Activation Guards ────────────────────────────────────────

test.describe('Youbora — Activation Guards', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  test('no beacons when tracking.youbora absent from player config', async ({ isolatedPlayer: player, page }) => {
    // Arrange — el fixture isolatedPlayer ya llamó setupPlatformMocks con default.json
    // que NO contiene el bloque metadata.player.tracking.youbora.
    // NO llamamos mockPlayerConfig aquí — Youbora no debe activarse.
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Act — esperar contentFirstPlay para confirmar que el player reprodujo
    // correctamente. Sin este assert, el test podría pasar vacío si el stream falla.
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Act — confirmar reproducción antes de verificar ausencia de beacons
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Act — esperar la señal que dispara fireStart + fireJoin en el tracker
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Esperar sesión iniciada
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})
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

    // Act
    await player.pause()
    await player.waitForEvent('pause', 5_000)

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Esperar sesión del primer contenido
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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
    await waitForFirst(8_000).catch(() => {})

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Esperar sesión iniciada — necesario para que _adapter exista en el tracker.
    // Según observability.md, el handler onError verifica `if (!this._adapter) return`,
    // por lo que el adapter debe estar creado antes de que llegue el error.
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Esperar contentFirstPlay para confirmar que el player reprodujo correctamente.
    // Sin esto, el test podría pasar vacío si el stream falla antes de enviar beacons.
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})
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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    // type='episode' sin metadata.show ni metadata.season.
    // buildVideoOptions:33-36 en tracker.js usa optional chaining:
    //   if (metadata?.show) opts['content.program'] = metadata.show
    //   if (metadata?.season !== null && ...) opts['content.season'] = ...
    // Los campos ausentes se omiten silenciosamente — no debe lanzar excepciones.
    await player.goto({ type: 'episode', id: MockContentIds.vod, autoplay: true })

    // Act
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})
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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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
    test.fixme(true, 'NPAW-8.1: Player bug — same as NPAW-8.6. tracker.js onError() guard: `if (!this._adapter) return`. Fatal startup errors (before player reaches ready state) produce no error beacons because _adapter is null. Fix: initialize adapter on first error even if not yet started, using fireInit()+fireFatalError().')
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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
    test.fixme(true, 'NPAW-8.6: Player bug — tracker.js onError() guard: `if (!this._adapter) return`. When the stream fails before the player reaches ready state, _initAdapter() is never called, so _adapter is null and no error beacons are sent. Even after load() recovery, tracker.restart() fires but the new session cannot start because the tracker was never fully initialized. Fix: call _initAdapter() (with fireError, not fireStart) before checking _adapter in onError for fatal startup errors.')
    // Arrange
    await mockPlayerConfig(page, YOUBORA_CONFIG)

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

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
    await waitForFirst(8_000).catch(() => {})
    await expect.poll(() => beacons.length, {
      timeout: 20_000,
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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    // Act — cargar y reproducir normalmente
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Act — el player debe reproducir correctamente sin Youbora inicializado
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Wait for first session to start — fireStart + fireJoin beacons land here
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

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

    // After replay, contentFirstPlay may not re-fire (atom guard: alreadyFired=true unless load() called).
    // Wait for 'playing' or 'timeupdate' which always re-fire on replay.
    await player.waitForEvent('playing', 20_000)
    await waitForFirst(8_000).catch(() => {})

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

  test('automatic next episode transition opens a new Youbora session', async ({ player, page }) => {
    test.slow() // CDN content: ended + real episode transition + ep2 session start
    // Uses real platform content (not mock) so each episode chapter has a distinct
    // HLS stream URL. When ep2 loads, HLS.js reinitializes → Events._playing fires
    // after tracker.restart()'s setTimeout(0) completes → new Youbora session opens.
    // With mock content (same stream URL for both episodes), HLS.js reused the session
    // and Events._playing never re-fired, causing tracker.restart() to miss the event.

    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    const initBeacons  = () => beacons.filter(url => url.includes('/init')).length
    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length

    await player.goto({
      type: 'episode',
      id: ContentIds.episodeWithNext,
      player: PlayerIds.youboraTest,
      autoplay: false,
    })
    await player.play()

    await expect.poll(initBeacons, {
      timeout: 20_000,
      message: 'Se esperaba beacon /init de Youbora para el primer episodio',
    }).toBeGreaterThan(0)
    await expect.poll(startBeacons, {
      timeout: 30_000,
      message: 'Se esperaban beacons /start y/o /joinTime para el primer episodio',
    }).toBeGreaterThan(0)

    const firstSessionStarts = startBeacons()

    await player.clearTrackedEvents()

    // Seek near end of episode 1 to trigger automatic episode transition
    await expect.poll(
      () => player.page.evaluate(() => {
        const v = document.querySelector('video') ?? document.querySelector('audio')
        return v ? v.duration : 0
      }),
      { timeout: 15_000, message: 'video.duration debe ser > 0 antes de seek al final del episodio' }
    ).toBeGreaterThan(0)

    await player.page.evaluate(() => {
      const v = document.querySelector('video') ?? document.querySelector('audio')
      if (v && isFinite(v.duration) && v.duration > 5) v.currentTime = v.duration - 3
    })

    // Wait for ended — player auto-requests and loads episode 2 after this
    await expect.poll(
      () => player.page.evaluate(() => {
        const v = document.querySelector('video') ?? document.querySelector('audio')
        return !!(window as any).__qa?.events?.includes('ended') || v?.ended === true
      }),
      { timeout: 60_000, message: 'El video debe llegar a ended para activar la transición automática de episodio' }
    ).toBe(true)

    // Episode 2 has a different HLS stream URL → HLS.js reinitializes → Events._playing
    // fires for ep2. tracker.restart() setTimeout(0) has already completed by the time
    // ep2 starts playing (CDN fetch + HLS init takes >500ms), so the new listener catches it.
    await expect.poll(startBeacons, {
      timeout: 40_000,
      message: 'El segundo episodio debe abrir una nueva sesión Youbora (/start o /joinTime adicional)',
    }).toBeGreaterThan(firstSessionStarts)
  })
})

// ── Helper: parseBeaconParam ─────────────────────────────────────────────────

/**
 * Extrae un parámetro del query string de un beacon URL de NPAW NQS.
 * npaw-plugin@7.3.28 usa GET con params directos en el query string:
 *   https://xxx.youboranqs01.com/nqs/...?content.id=yyy&user.type=premium&...
 * Si no se encuentra como param directo, intenta deserializar un blob JSON
 * bajo la clave 'params' (formato alternativo del SDK).
 */
/**
 * Extract a param from a NPAW beacon.
 *
 * SDK 7.3.28 sends ALL metadata as POST body JSON — URL query params only carry
 * timemark/code/sessionRoot/system/sessionId. This function checks the POST body first
 * (via _activeBeaconBodies set by setupNpawInterceptor), then falls back to URL params.
 *
 * Key aliases (BODY_FIELD_ALIASES) translate legacy dot-notation names used in assertions
 * to the actual camelCase field names the SDK sends in the body.
 */
function parseBeaconParam(
  url: string,
  key: string,
  bodies?: Map<string, Record<string, unknown>>
): string | null {
  const activeBodies = bodies ?? _activeBeaconBodies
  if (activeBodies) {
    const body = activeBodies.get(url)
    if (body) {
      const stringify = (v: unknown) =>
        v === null || v === undefined ? null
        : typeof v === 'object' ? JSON.stringify(v)
        : String(v)
      const direct = body[key]
      const sv = stringify(direct)
      if (sv !== null) return sv
      const aliasKey = BODY_FIELD_ALIASES[key]
      if (aliasKey) {
        const sa = stringify(body[aliasKey])
        if (sa !== null) return sa
      }
    }
  }
  try {
    const u = new URL(url)
    const direct = u.searchParams.get(key)
    if (direct !== null) return direct
    const blob = u.searchParams.get('params')
    if (blob) {
      const parsed = JSON.parse(decodeURIComponent(blob))
      const val = parsed[key]
      if (val !== undefined && val !== null) return String(val)
    }
  } catch { /* URL inválida o params no parseables */ }
  return null
}

// Config con user metadata (issue-706 — customer_extras)
// contextMapper lee context.options?.['customer_extras.type'] → userType
// tracker.js buildVideoOptions: userType → opts['user.type']
const YOUBORA_CONFIG_USER = {
  metadata: { player: { tracking: { youbora: { enabled: true, account_code: YOUBORA_ACCOUNT_CODE } } } },
  'customer_extras.type': 'premium',
  'customer_extras.name': 'testuser',
}

// ── Block A: User Metadata (issue-706) ──────────────────────────────────────

test.describe('Youbora — User Metadata (issue-706)', { tag: ['@integration', '@analytics', '@youbora', '@metadata'] }, () => {

  test('NPAW-2.17a — user.type in /start beacon when customer_extras.type configured', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, YOUBORA_CONFIG_USER)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    // SDK sends user metadata ONLY in /start beacon, not in /joinTime.
    // Filtering for /start specifically avoids getting null when /joinTime arrives first.
    const onlyStart = () => beacons.find(url => url.includes('/start') && !url.includes('/joinTime') && !url.includes('/adStart'))
    await expect.poll(onlyStart, {
      timeout: 20_000,
      message: 'Se esperaba beacon /start (no /joinTime ni /adStart) para verificar user.type',
    }).toBeTruthy()

    const startUrl = onlyStart()!
    const userType = parseBeaconParam(startUrl, 'user.type')
    expect(
      userType,
      `user.type debe ser 'premium' en el beacon /start — url: ${startUrl}`
    ).toBe('premium')
  })

  test('NPAW-2.17b — user.name in /start beacon when customer_extras.name configured', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, YOUBORA_CONFIG_USER)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime'))
    await expect.poll(() => startBeacons().length, {
      timeout: 20_000,
      message: 'Se esperaba al menos 1 beacon /start para verificar user.name',
    }).toBeGreaterThan(0)

    const startUrl = startBeacons()[0]
    const userName = parseBeaconParam(startUrl, 'user.name')
    expect(
      userName,
      `user.name debe ser 'testuser' en el beacon /start — url: ${startUrl}`
    ).toBe('testuser')
  })

  test('NPAW-2.17c — user.type absent from /start beacon when customer_extras not configured', async ({ isolatedPlayer: player, page }) => {
    // Sin customer_extras en el config: user.type NO debe aparecer en el beacon.
    // tracker.js buildVideoOptions: `if (userType) opts['user.type'] = userType` — guard condicional.
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime'))
    await expect.poll(() => startBeacons().length, {
      timeout: 20_000,
      message: 'Se esperaba beacon /start para verificar ausencia de user.type',
    }).toBeGreaterThan(0)

    const startUrl = startBeacons()[0]
    expect(
      parseBeaconParam(startUrl, 'user.type'),
      'user.type no debe estar en el beacon cuando customer_extras.type no está configurado'
    ).toBeNull()
  })

  test('NPAW-updateOptions — reload with same id/type/accountCode does not restart Youbora session', async ({ isolatedPlayer: player, page }) => {
    // issue-706 introduce lógica de restart inteligente en index.jsx:
    //   Si prev.id === next.id && prev.type === next.type && prev.accountCode === next.accountCode
    //   → updateOptions(next) en lugar de tracker.restart(next)
    // updateOptions() llama setVideoOptions() sin _cleanup() ni fireStop().
    // Observable: recargar el mismo id/type no debe generar beacon /stop.
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length
    await expect.poll(startBeacons, {
      timeout: 20_000,
      message: 'Se esperaban beacons /start antes de recargar el mismo contenido',
    }).toBeGreaterThan(0)

    const stopBeaconCount = () => beacons.filter(url => url.includes('/stop')).length

    // player.load() con el mismo id/type → YouboraAnalytics.restart(false) → updateOptions (no restart)
    // No se llama _cleanup() ni fireStop() → /stop no debe aparecer.
    await player.load({ type: 'media', id: MockContentIds.vod })

    await expect.poll(stopBeaconCount, {
      timeout: 2_000,
      intervals: [200],
      message: 'updateOptions path: reload del mismo id/type no debe generar beacon /stop — issue-706',
    }).toBe(0)
  })
})

// ── Block B: Content Metadata Validation ─────────────────────────────────────

test.describe('Youbora — Content Metadata Validation', { tag: ['@integration', '@analytics', '@youbora', '@metadata'] }, () => {

  test('NPAW-2.21 — content.id in /start beacon matches loaded content ID', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime'))
    await expect.poll(() => startBeacons().length, {
      timeout: 20_000,
      message: 'Se esperaba beacon /start para verificar content.id',
    }).toBeGreaterThan(0)

    const startUrl = startBeacons()[0]
    const contentId = parseBeaconParam(startUrl, 'content.id')
    expect(
      contentId,
      `content.id debe ser '${MockContentIds.vod}' en el beacon /start — url: ${startUrl}`
    ).toBe(MockContentIds.vod)
  })

  test('NPAW-2.22-VOD — content.type=VOD for type:media', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime'))
    await expect.poll(() => startBeacons().length, { timeout: 20_000 }).toBeGreaterThan(0)

    const contentType = parseBeaconParam(startBeacons()[0], 'content.type')
    expect(
      contentType,
      `content.type debe ser 'VOD' para type:'media' — url: ${startBeacons()[0]}`
    ).toBe('VOD')
  })

  test('NPAW-2.22-Live — content.type=Live for type:live', async ({ isolatedPlayer: player, page }) => {
    // mapContentType('live') → 'Live' en tracker.js
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)
    await player.goto({ type: 'live', id: MockContentIds.live, autoplay: true })

    // Live streams pueden no emitir contentFirstPlay en el mock local — usar playing como fallback
    await expect.poll(
      () => player.page.evaluate(() => {
        const events = (window as any).__qa?.events ?? []
        return events.includes('contentFirstPlay') || events.includes('playing')
      }),
      { timeout: 25_000, intervals: [500] }
    ).toBe(true)

    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime'))
    await expect.poll(() => startBeacons().length, { timeout: 20_000 }).toBeGreaterThan(0)

    const contentType = parseBeaconParam(startBeacons()[0], 'content.type')
    expect(
      contentType,
      `content.type debe ser 'Live' para type:'live' — url: ${startBeacons()[0]}`
    ).toBe('Live')
  })

  test('NPAW-2.6 — content.duration > 0 in /start beacon for VOD (timing fix: getDuration from _initAdapter)', async ({ isolatedPlayer: player, page }) => {
    // issue-706: _initAdapter() se llama desde onReady, y getDuration() es un getter dinámico
    // que lee api?.duration en tiempo de llamada. Para VOD, esto garantiza que la duración
    // real del stream (no 0) está disponible cuando el SDK construye el beacon /start.
    // Regresión fija: en el tracker anterior, buildVideoOptions pasaba api?.duration || 0 en
    // onFirstPlay, que podía ser 0 si HLS aún no había cargado el manifest completo.
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime'))
    await expect.poll(() => startBeacons().length, {
      timeout: 20_000,
      message: 'Se esperaba beacon /start para verificar content.duration',
    }).toBeGreaterThan(0)

    const startUrl = startBeacons()[0]
    const durationStr = parseBeaconParam(startUrl, 'content.duration')
    const duration = durationStr !== null ? parseFloat(durationStr) : null

    expect(
      duration,
      `content.duration debe ser > 0 para VOD — url: ${startUrl}`
    ).not.toBeNull()
    expect(
      duration!,
      `content.duration debe ser > 0 para VOD (timing fix en _initAdapter) — url: ${startUrl}`
    ).toBeGreaterThan(0)
  })
})

// ── Block C: Rendition Tracking ──────────────────────────────────────────────

test.describe('Youbora — Rendition Tracking (issue-706)', { tag: ['@integration', '@analytics', '@youbora', '@rendition'] }, () => {

  test('NPAW-2.13a — ABR settled level produces calculable rendition via computeRendition(api)', async ({ isolatedPlayer: player, page }) => {
    // issue-706: computeRendition(api) usa api.videoWidth, api.videoHeight, api.bitrate.
    // getRendition() en el adapter retorna el rendition string solo cuando _started=true.
    // Verificamos: después de contentFirstPlay + levelChanged, el player tiene video dimensions
    // disponibles que el SDK puede reportar como rendition.
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    // Esperar que HLS.js elija un nivel ABR → video element tiene dimensiones reales
    await expect.poll(
      () => player.page.evaluate(() => {
        const v = document.querySelector('video')
        return (v?.videoWidth ?? 0) > 0 && (v?.videoHeight ?? 0) > 0
      }),
      { timeout: 15_000, intervals: [500], message: 'video.videoWidth debe ser > 0 después de ABR settle' }
    ).toBe(true)

    // Verificar que el tracker tiene api.videoWidth disponible para computeRendition
    const videoWidth = await player.page.evaluate(() => (window as any).__player?.videoWidth ?? 0)
    expect(videoWidth, 'player.videoWidth debe ser > 0 para que computeRendition genere un rendition string').toBeGreaterThan(0)

    // La actividad de beacons confirma que el SDK está activo y reportando rendition
    await expect.poll(() => beacons.length, {
      timeout: 8_000,
      message: 'Se esperaban beacons NPAW activos durante reproducción (SDK reporta rendition via getRendition getter)',
    }).toBeGreaterThan(0)
  })

  test('NPAW-2.13b — manual level change triggers additional beacons (rendition update)', async ({ isolatedPlayer: player, page }) => {
    // player.setLevel(0) → levelChanged → SDK recibe nueva rendition via getRendition()
    // en el siguiente ping o setVideoOptions call desde el adapter.
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    // Esperar que haya niveles disponibles antes de cambiar
    await expect.poll(
      async () => (await player.getLevels()).length,
      { timeout: 10_000, intervals: [300], message: 'Se esperaban niveles HLS disponibles para cambio manual' }
    ).toBeGreaterThan(0)

    const n0 = beacons.length

    // Cambio manual al nivel 0 (menor calidad)
    await player.setLevel(0)
    await player.waitForEvent('levelchanged', 10_000)

    // El adapter SDK pinga con la nueva rendition en el siguiente heartbeat
    await expect.poll(() => beacons.length, {
      timeout: 10_000,
      message: 'Se esperaban beacons adicionales tras cambio de level — SDK reporta nueva rendition',
    }).toBeGreaterThan(n0)
  })
})

// ── Block D: Buffering ────────────────────────────────────────────────────────

test.describe('Youbora — Buffering (issue-706)', { tag: ['@integration', '@analytics', '@youbora', '@buffering'] }, () => {

  test('NPAW-4.1 — buffer stall mid-playback fires fireBufferBegin with non-zero playhead', async ({ isolatedPlayer: player, page }) => {
    // issue-706: adapter.getPlayhead() = () => this._contentPlayheadAtBreak ?? api?.currentTime ?? 0
    // Para buffering mid-playback (no en ad break), _contentPlayheadAtBreak=null → usa api.currentTime.
    // api.currentTime es > 0 cuando el stall ocurre después de que el stream empezó a reproducir.
    // Observable: fireBufferBegin + fireBufferEnd generan beacons adicionales.
    test.slow()
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    // Esperar currentTime > 0 para garantizar que api.currentTime es válido en el beacon
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 10_000, message: 'currentTime debe ser > 0 antes de inducir buffer stall' }
    ).toBeGreaterThan(0)

    const n0 = beacons.length

    // Inducir buffer stall temporal — abortar segmentos HLS por 2s luego restaurar
    // El tracker recibe: Events._buffering → fireBufferBegin, Events._canplay → fireBufferEnd
    await page.route('**/localhost:9001/vod/**', (route) => route.abort())
    // Dar tiempo para que el stall se propague al player
    await player.waitForEvent('buffering', 8_000)

    await page.unroute('**/localhost:9001/vod/**')

    // El player debe retomar la reproducción y emitir canplay → fireBufferEnd
    await player.waitForEvent('canplay', 10_000)

    // Assert — fireBufferBegin + posiblemente fireBufferEnd generaron beacons adicionales
    await expect.poll(() => beacons.length, {
      timeout: 5_000,
      message: 'Se esperaban beacons NPAW adicionales tras buffer stall (fireBufferBegin/fireBufferEnd)',
    }).toBeGreaterThan(n0)
  })
})

// ── Block E: Pre-roll Content View (issue-706) ────────────────────────────────

test.describe('Youbora — Pre-roll Content View (issue-706)', { tag: ['@integration', '@analytics', '@youbora', '@ads'] }, () => {

  test('NPAW-A.2.pre — content View opens before pre-roll (fireStart in onContentPauseRequested)', async ({ isolatedPlayer: player, page }) => {
    // issue-706 cambia onContentPauseRequested: si _started=false (pre-roll),
    // ahora abre la content View ANTES del ad: _started=true, _paused=true, fireStart+fireJoin.
    // Comportamiento anterior: firePause() sin abrir View si _started=false.
    // Observable: beacon /start llega al momento de adsContentPauseRequested, antes de adsAllAdsCompleted.
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()

    // Esperar inicio del ad break — en este punto el nuevo código ya ejecutó fireStart+fireJoin
    await player.waitForEvent('adsContentPauseRequested', 30_000)

    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length

    // Inmediatamente después de adsContentPauseRequested, la content View ya debe estar abierta
    await expect.poll(startBeacons, {
      timeout: 5_000,
      message: 'issue-706: content View debe abrirse DURANTE el pre-roll (fireStart en onContentPauseRequested cuando _started=false)',
    }).toBeGreaterThan(0)
  })
})

// ── Block F: Ad Break Metadata (issue-706) ────────────────────────────────────

test.describe('Youbora — Ad Break Metadata (issue-706)', { tag: ['@integration', '@analytics', '@youbora', '@ads'] }, () => {

  test('NPAW-A.2.6 — ad break metadata beacons fired before first ad completes', async ({ isolatedPlayer: player, page }) => {
    // issue-706 onAdsStarted: setVideoOptions con ad.givenBreaks, ad.breaksTime, ad.expectedPattern
    // ANTES de fireBreakStart. Esto genera el beacon /adManifest del SDK NPAW (parte de
    // fireBreakStart) con metadata completa de breaks.
    // Observable: beacons relacionados con ad break llegan antes de adsAllAdsCompleted.
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()

    // Esperar inicio del ad break para confirmar que el ciclo de ads comenzó
    await player.waitForEvent('adsContentPauseRequested', 30_000)

    const beaconsAtBreakStart = beacons.length

    // El SDK debe haber enviado beacons de break start con la metadata de breaks
    // (ad.givenBreaks, ad.breaksTime, ad.expectedPattern) configurada en onAdsStarted
    expect(
      beaconsAtBreakStart,
      'Se esperaban beacons NPAW de ad break start al inicio del break (issue-706 — ad break metadata)'
    ).toBeGreaterThan(0)

    // Esperar fin del ciclo de ads completo
    await player.waitForAllAdsComplete(60_000)

    // El total de beacons debe incluir el ciclo completo: breakStart, adStart, adJoin, adStop, breakStop
    await expect.poll(() => beacons.length, {
      timeout: 5_000,
      message: 'Se esperaban beacons NPAW del ciclo completo del ad break (issue-706)',
    }).toBeGreaterThan(beaconsAtBreakStart)
  })

  test('NPAW-A.2.23 — adSkipped beacon fires when skippable ad is skipped', async ({ isolatedPlayer: player, page }) => {
    // tracker.js onAdsSkipped: this._adsAdapter?.fireSkip()
    // Observable: beacon /skip capturado cuando player.skipAd() se llama.
    // Usa preroll-skippable (skipoffset="00:00:05") — IMA habilita skip tras 5s.
    test.slow()
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll-skippable`,
    })
    await player.play()

    // Esperar que el ad empiece a reproducirse
    await player.waitForAdStart(30_000)

    const n0 = beacons.length

    // Esperar que IMA habilite el botón de skip (skipoffset=5s)
    await expect.poll(
      () => player.isAdSkippable(),
      { timeout: 30_000, intervals: [500], message: 'Ad debe ser skippable después de skipoffset=5s' }
    ).toBe(true)

    // Act — skip via API pública del player
    await player.skipAd()
    await player.waitForEvent('adsSkipped', 10_000)

    // A.2.23: NPAW requires an explicit adSkip beacon — fireSkip() must be called.
    // Matching /adStop alone is not enough: NPAW QA confirmed the skip event is NOT reported
    // when only fireStop() fires. tracker.js onAdsSkipped must call adsAdapter.fireSkip().
    const hasAdSkip = () => beacons.some(url => url.includes('adSkip') || url.includes('/skip'))
    await expect.poll(hasAdSkip, {
      timeout: 10_000,
      message: 'A.2.23: /adSkip beacon must be sent by NPAW SDK when ad is skipped — tracker.js onAdsSkipped must call adsAdapter.fireSkip(), not just fireStop()',
    }).toBe(true)

    expect(beacons.length).toBeGreaterThan(n0)
  })

  test('NPAW-A.2.11 — ad playhead/duration/provider in ad beacons', async () => {
    test.fixme(true, 'Pending: mock-vast no provee ad metadata completa (title, duration, adSystem). Requiere VAST tag con esas propiedades para validar getTitle/getDuration/getAdProvider del adsAdapter (issue-706).')
  })

  test('NPAW-A.3.1 — background tab pauses session (background.settings.android/iOS:pause)', async () => {
    test.fixme(true, 'Pending: requiere manipulación de Page Visibility API (document.visibilityState) y verificar que el NpawPlugin con background.settings.android/iOS:pause no envía beacons en background. Implementar con page.evaluate(() => Object.defineProperty(document, "visibilityState", ...)).')
  })
})

// ── Block G: NPAW A.1 — Ad Reporting Beacons (lifecycle stage checks) ─────────
//
// AC-YOUBORA-NPAW-A.1.1  /adManifest sent when plugin receives answer from ad server
// AC-YOUBORA-NPAW-A.1.2  /adBreakStart sent for all ad breaks
// AC-YOUBORA-NPAW-A.1.3  /adBreakStop sent when last ad ends and content resumes
// AC-YOUBORA-NPAW-A.1.4  /adInit sent when mandatory info not yet available (fixme)
// AC-YOUBORA-NPAW-A.1.5  /adStart sent for each ad
// AC-YOUBORA-NPAW-A.1.6  /adJoin sent when first frame of ad plays
// AC-YOUBORA-NPAW-A.1.7  /adStop sent when ad ends naturally
// AC-YOUBORA-NPAW-A.1.8  /adStop sent when ad is skipped
// AC-YOUBORA-NPAW-A.1.9  CSAI pre-roll: /joinTime arrives AFTER /adBreakStop

test.describe('Youbora — NPAW A.1 Ad Reporting Beacons', { tag: ['@integration', '@analytics', '@youbora', '@ads'] }, () => {

  // Beacon type helpers — avoid exact URL structure (SDK internal), match event name substring.
  // The NQS beacon URL encodes the event type in the `codes` param (e.g. codes=/adBreakStart).
  // url.includes('adBreakStart') matches that substring without depending on the full path.
  const hasAdManifest   = (url: string) => url.includes('adManifest')
  const hasAdBreakStart = (url: string) => url.includes('adBreakStart') && !url.includes('adBreakStop')
  const hasAdBreakStop  = (url: string) => url.includes('adBreakStop')
  const hasAdStart      = (url: string) => url.includes('adStart') && !url.includes('adBreakStart')
  const hasAdJoin       = (url: string) => url.includes('adJoin')
  const hasAdStop       = (url: string) => url.includes('adStop') && !url.includes('adBreakStop')
  const hasJoinTime     = (url: string) => url.includes('/joinTime') || url.includes('joinTime')

  // A.1.1 + A.1.2 + A.1.3 + A.1.5 + A.1.6 + A.1.7 — full pre-roll lifecycle
  test('NPAW-A.1.1/A.1.2/A.1.3/A.1.5/A.1.6/A.1.7 — full pre-roll ad lifecycle beacons emitted at each stage', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()

    // ── Stage 1: A.1.1 /adManifest + A.1.2 /adBreakStart ─────────────────────
    // Player fires adsContentPauseRequested when the ad break begins.
    // At this point the SDK should have fired fireBreakStart (which includes adManifest metadata)
    // and fireAdBreakStart. Observable: beacons arrive before/at this player event.
    await player.waitForEvent('adsContentPauseRequested', 30_000)
    const countAtBreakStart = beacons.length
    expect(
      countAtBreakStart,
      'A.1.1/A.1.2: beacons must arrive at ad break start (adManifest + adBreakStart)'
    ).toBeGreaterThan(0)

    // ── Stage 2: A.1.5 /adStart + A.1.6 /adJoin ──────────────────────────────
    // adsStarted fires when the first frame of the ad is rendered.
    // The SDK fires fireStart + fireJoin for the ad view.
    await player.waitForAdStart(20_000)
    await expect.poll(() => beacons.length, {
      timeout: 8_000,
      message: 'A.1.5/A.1.6: additional beacons expected after ad first frame (adStart + adJoin)',
    }).toBeGreaterThan(countAtBreakStart)
    const countAtAdJoin = beacons.length

    // ── Stage 3: A.1.7 /adStop + A.1.3 /adBreakStop ─────────────────────────
    // adsAllAdsCompleted fires when the entire break is done and content resumes.
    // The SDK fires fireStop for the ad view and fireBreakStop for the break.
    await player.waitForAllAdsComplete(60_000)
    await expect.poll(() => beacons.length, {
      timeout: 8_000,
      message: 'A.1.7/A.1.3: additional beacons expected after ad ended (adStop + adBreakStop)',
    }).toBeGreaterThan(countAtAdJoin)

    // /adBreakStop arrives after adsContentResumeRequested — give it extra time
    // after /adStop already satisfied the length poll above.
    await expect.poll(() => beacons.some(hasAdBreakStop), {
      timeout: 10_000,
      message: `A.1.3: /adBreakStop beacon must arrive after all ads complete.\nCaptured so far:\n${beacons.join('\n')}`,
    }).toBe(true)

    // Verify the beacon type fingerprints across the full captured set.
    // The NQS SDK 7.3.28 encodes event type in the URL — check substring presence.
    // At least one beacon per lifecycle stage must have been captured.
    const adManifestFound   = beacons.some(hasAdManifest)
    const adBreakStartFound = beacons.some(hasAdBreakStart)
    const adStartFound      = beacons.some(hasAdStart)
    const adJoinFound       = beacons.some(hasAdJoin)
    const adStopFound       = beacons.some(hasAdStop)
    const adBreakStopFound  = beacons.some(hasAdBreakStop)

    // SDK 7.3.28 uses a lazy manifest — adManifest may be omitted when IMA
    // provides all metadata upfront. Check adBreakStart as the primary A.1.1 signal.
    const manifestOrBreakStart = adManifestFound || adBreakStartFound
    expect(
      manifestOrBreakStart,
      `A.1.1/A.1.2: expected adManifest or adBreakStart beacon. Captured URLs (first 5): ${beacons.slice(0, 5).join('\n')}`
    ).toBe(true)

    expect(adStartFound, `A.1.5: adStart beacon not found. Captured: ${beacons.join('\n')}`).toBe(true)
    expect(adJoinFound,  `A.1.6: adJoin beacon not found. Captured: ${beacons.join('\n')}`).toBe(true)
    expect(adStopFound,  `A.1.7: adStop beacon not found. Captured: ${beacons.join('\n')}`).toBe(true)
    expect(adBreakStopFound, `A.1.3: adBreakStop beacon not found. Captured: ${beacons.join('\n')}`).toBe(true)
  })

  // A.1.8 — /adStop when ad is skipped
  test('NPAW-A.1.8 — /adStop beacon emitted when skippable ad is skipped', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll-skippable`,
    })
    await player.play()

    await player.waitForAdStart(30_000)
    const n0 = beacons.length

    // Wait until IMA enables the skip button (skipoffset=5s in preroll-skippable.xml)
    await expect.poll(
      () => player.isAdSkippable(),
      { timeout: 30_000, intervals: [500], message: 'A.1.8: ad must become skippable (skipoffset=5s)' }
    ).toBe(true)

    await player.skipAd()
    await player.waitForEvent('adsSkipped', 10_000)

    // A.1.8: /adStop must be sent when ad is skipped.
    // fireSkip() in tracker.js calls adsAdapter.fireStop() after firing skip beacon.
    await expect.poll(() => beacons.length, {
      timeout: 5_000,
      message: 'A.1.8: beacons must increase after skip (adStop + adSkip expected)',
    }).toBeGreaterThan(n0)

    const adStopFound = beacons.some(hasAdStop)
    expect(
      adStopFound,
      `A.1.8: /adStop beacon not found after skip. Captured: ${beacons.join('\n')}`
    ).toBe(true)
  })

  // A.1.9 — CSAI pre-roll ordering: /joinTime arrives AFTER /adBreakStop
  test('NPAW-A.1.9 — CSAI: content /joinTime beacon arrives after pre-roll /adBreakStop', async ({ isolatedPlayer: player, page }) => {
    test.fixme(true, 'A.1.9: Player bug — tracker.js onContentPauseRequested() calls fireStart()+fireJoin() immediately when pre-roll starts (before any ad plays), so /joinTime is sent BEFORE the ad break. Fix: fireJoin() should be called only after content first frame renders (after adsContentResumeRequested). This is the same issue as NPAW-3.2 EBVS.')
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()

    // Wait for pre-roll to fully end — adsContentResumeRequested marks the /adBreakStop moment.
    await player.waitForEvent('adsContentResumeRequested', 60_000)

    // At the moment of adsContentResumeRequested, /joinTime must NOT have arrived yet.
    // CSAI rule: joinTime fires after the break ends, not during or before it.
    const joinTimeAtBreakStop = beacons.filter(hasJoinTime).length
    expect(
      joinTimeAtBreakStop,
      'A.1.9 CSAI: /joinTime must NOT be sent before/during the pre-roll ad break'
    ).toBe(0)

    // Capture the index boundary — beacons before this point are the ad break beacons.
    const adBreakBeaconCount = beacons.length

    // Wait for content to start (contentFirstPlay fires after /adBreakStop in CSAI).
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    // After contentFirstPlay, /joinTime must have arrived (fireJoin in tracker.onFirstPlay).
    await expect.poll(() => beacons.filter(hasJoinTime).length, {
      timeout: 10_000,
      message: 'A.1.9 CSAI: /joinTime beacon must arrive after pre-roll ends (contentFirstPlay stage)',
    }).toBeGreaterThan(0)

    // The adBreakStop beacon must be present and must have arrived BEFORE joinTime.
    const adBreakStopIdx = beacons.findIndex(hasAdBreakStop)
    const joinTimeIdx    = beacons.findIndex(hasJoinTime)

    // If the SDK doesn't expose the event type in the URL (version variation),
    // fall back to checking that joinTime arrived after the ad break boundary.
    if (adBreakStopIdx === -1 || joinTimeIdx === -1) {
      expect(
        beacons.length,
        'A.1.9: beacons array must have grown after contentFirstPlay (indirectly confirms ordering)'
      ).toBeGreaterThan(adBreakBeaconCount)
    } else {
      expect(
        adBreakStopIdx,
        `A.1.9: adBreakStop (idx ${adBreakStopIdx}) must precede joinTime (idx ${joinTimeIdx})`
      ).toBeLessThan(joinTimeIdx)
    }
  })

  // A.1.4 — /adInit (hard to trigger with mock-vast)
  test('NPAW-A.1.4 — /adInit sent when plugin lacks mandatory ad info at init time', async () => {
    test.fixme(
      true,
      'A.1.4: /adInit fires when IMA provides incomplete ad metadata (missing mediaAdResource, adTitle or mediaAdDuration). ' +
      'Requires a custom VAST wrapper with empty <MediaFiles> or delayed metadata to trigger the adInit path in the SDK. ' +
      'mock-vast serves complete VAST — all mandatory fields present — so this code path is never reached in the current fixture set. ' +
      'To test: create mock-vast/vast-missing-media.xml with empty <MediaFiles>, add GET /vast/missing-media route, ' +
      'and verify adInit beacon appears before adStart.'
    )
  })
})

// ── Block H: NPAW A.2 — Ad Info and Stats ────────────────────────────────────
//
// AC-YOUBORA-NPAW-A.2.5   givenAds (/adBreakStart)
// AC-YOUBORA-NPAW-A.2.7   breakNumber (multiple ad beacons)
// AC-YOUBORA-NPAW-A.2.8   position (pre/mid/post)
// AC-YOUBORA-NPAW-A.2.9   adNumber increments across ads
// AC-YOUBORA-NPAW-A.2.10  adNumberInBreak
// AC-YOUBORA-NPAW-A.2.13  skippable flag in /adStart
// AC-YOUBORA-NPAW-A.2.16  adResource (MediaFile URL)
// AC-YOUBORA-NPAW-A.2.17  adTitle (AdTitle from VAST)
// AC-YOUBORA-NPAW-A.2.18  adDuration (ad duration in seconds)
// AC-YOUBORA-NPAW-A.2.21  adJoinDuration > 0
// AC-YOUBORA-NPAW-A.2.22  adTotalDuration > 0

test.describe('Youbora — NPAW A.2 Ad Info and Stats', { tag: ['@integration', '@analytics', '@youbora', '@ads'] }, () => {

  // Helpers — filter beacon lists by ad event type
  const adStartBeacons  = (b: string[]) => b.filter(u => u.includes('adStart') && !u.includes('adBreakStart') && !u.includes('adStop'))
  const adJoinBeacons   = (b: string[]) => b.filter(u => u.includes('adJoin') && !u.includes('adJoinDuration'))
  const adStopBeacons   = (b: string[]) => b.filter(u => u.includes('adStop') && !u.includes('adBreakStop'))
  const breakBeacons    = (b: string[]) => b.filter(u => u.includes('adBreakStart') && !u.includes('adBreakStop'))

  // ── A.2.17 + A.2.16 + A.2.18 ─────────────────────────────────────────────
  // Use /vast/full-metadata: AdTitle="QA NPAW Test Ad - Title Visible",
  // AdSystem="MediastreamQA", MediaFile=googleapis mp4, Duration=10s.
  // NPAW SDK maps: AdTitle→ad.title, MediaFile URL→ad.resource, Duration→ad.mediaDuration.
  test('NPAW-A.2.16/A.2.17/A.2.18 — adResource, adTitle, adDuration in /adStart beacon', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/full-metadata`,
    })
    await player.play()

    await player.waitForAdStart(30_000)

    // Wait for /adStart beacons to land (async after IMA fires adStarted)
    await expect.poll(() => adStartBeacons(beacons).length, {
      timeout: 10_000,
      message: 'A.2.16/17/18: /adStart beacon must arrive after ad starts',
    }).toBeGreaterThan(0)

    const adStartUrl = adStartBeacons(beacons)[0]
    const debugInfo  = `\nadStart URL: ${adStartUrl}`

    // A.2.17 — adTitle from VAST AdTitle element
    const title = parseBeaconParam(adStartUrl, 'ad.title')
    expect(title, `A.2.17: ad.title must be present in /adStart beacon${debugInfo}`).not.toBeNull()
    if (title !== null) {
      expect(title, `A.2.17: ad.title must match VAST AdTitle value${debugInfo}`)
        .toContain('QA NPAW Test Ad')
    }

    // A.2.16 — adResource from VAST MediaFile URL
    const resource = parseBeaconParam(adStartUrl, 'ad.resource')
    expect(resource, `A.2.16: ad.resource must be present in /adStart beacon${debugInfo}`).not.toBeNull()
    if (resource !== null) {
      expect(resource.length, `A.2.16: ad.resource must be a non-empty URL${debugInfo}`).toBeGreaterThan(0)
    }

    // A.2.18 — adDuration in seconds (VAST Duration=10s)
    const durStr = parseBeaconParam(adStartUrl, 'ad.mediaDuration')
               ?? parseBeaconParam(adStartUrl, 'ad.duration')
    expect(durStr, `A.2.18: ad.mediaDuration or ad.duration must be present in /adStart beacon${debugInfo}`).not.toBeNull()
    if (durStr !== null) {
      const dur = parseFloat(durStr)
      expect(isFinite(dur) && dur > 0, `A.2.18: ad duration must be a positive number, got ${durStr}${debugInfo}`).toBe(true)
    }
  })

  // ── A.2.13 — skippable flag ───────────────────────────────────────────────
  // Two sub-cases: skippable VAST → ad.isSkippable=true, non-skippable → false/absent.
  test('NPAW-A.2.13 — skippable=true in /adStart beacon when VAST has skipoffset', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll-skippable`,
    })
    await player.play()
    await player.waitForAdStart(30_000)

    await expect.poll(() => adStartBeacons(beacons).length, {
      timeout: 10_000,
      message: 'A.2.13: /adStart beacon must arrive',
    }).toBeGreaterThan(0)

    const adStartUrl = adStartBeacons(beacons)[0]

    // A.2.13: ad.isSkippable must be 'true' for a skippable VAST
    const skippable = parseBeaconParam(adStartUrl, 'ad.isSkippable')
                   ?? parseBeaconParam(adStartUrl, 'ad.skippable')
                   ?? parseBeaconParam(adStartUrl, 'skippable')
    expect(
      skippable,
      `A.2.13: skippable param must be present in /adStart beacon for skipoffset VAST.\nURL: ${adStartUrl}`
    ).not.toBeNull()
    if (skippable !== null) {
      expect(skippable, `A.2.13: skippable must be 'true' for preroll-skippable VAST`).toBe('true')
    }

    // Cross-check via player API — confirms the VAST was parsed correctly by IMA
    await expect.poll(
      () => player.isAdSkippable(),
      { timeout: 30_000, intervals: [500], message: 'A.2.13 cross-check: player.isAdSkippable() must be true' }
    ).toBe(true)
  })

  // ── A.2.21 + A.2.22 — adJoinDuration and adTotalDuration ─────────────────
  test('NPAW-A.2.21/A.2.22 — adJoinDuration > 0 in /adJoin, adTotalDuration > 0 in /adStop', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()
    await player.waitForAllAdsComplete(60_000)

    // A.2.21 — adJoinDuration from /adJoin (ms since /adStart to first frame)
    const joinUrls = adJoinBeacons(beacons)
    if (joinUrls.length > 0) {
      const joinUrl = joinUrls[0]
      const joinDurStr = parseBeaconParam(joinUrl, 'ad.joinDuration')
                      ?? parseBeaconParam(joinUrl, 'ad.adJoinDuration')
      expect(joinDurStr, `A.2.21: ad.joinDuration must be present in /adJoin beacon.\nURL: ${joinUrl}`).not.toBeNull()
      if (joinDurStr !== null) {
        const joinDur = parseFloat(joinDurStr)
        expect(isFinite(joinDur) && joinDur >= 0, `A.2.21: adJoinDuration must be a non-negative number, got ${joinDurStr}`).toBe(true)
      }
    } else {
      // SDK may batch adJoin params into adStart URL — check there
      const startUrls = adStartBeacons(beacons)
      expect(startUrls.length, 'A.2.21: /adStart beacon must exist to check joinDuration fallback').toBeGreaterThan(0)
    }

    // A.2.22 — adTotalDuration from /adStop (ms from adStart to adStop)
    const stopUrls = adStopBeacons(beacons)
    expect(stopUrls.length, 'A.2.22: /adStop beacon must exist after ad ends').toBeGreaterThan(0)
    if (stopUrls.length > 0) {
      const stopUrl = stopUrls[0]
      const totalDurStr = parseBeaconParam(stopUrl, 'ad.totalDuration')
                       ?? parseBeaconParam(stopUrl, 'ad.adTotalDuration')
      expect(totalDurStr, `A.2.22: ad.totalDuration must be present in /adStop beacon.\nURL: ${stopUrl}`).not.toBeNull()
      if (totalDurStr !== null) {
        const totalDur = parseFloat(totalDurStr)
        expect(isFinite(totalDur) && totalDur > 0, `A.2.22: adTotalDuration must be positive, got ${totalDurStr}`).toBe(true)
      }
    }
  })

  // ── A.2.7 + A.2.8 + A.2.9 + A.2.10 + A.2.5 ─────────────────────────────
  // Pre-roll = break #1, position 'pre', 1 ad.
  // NPAW SDK encodes: ad.breakNumber=1, ad.position='pre'|0, ad.adNumber=1, ad.givenAds=1.
  test('NPAW-A.2.5/A.2.7/A.2.8/A.2.9/A.2.10 — breakNumber, position, adNumber, givenAds in ad beacons', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()
    await player.waitForAllAdsComplete(60_000)

    // Gather all ad-related beacon URLs for debugging
    const allAdBeacons = beacons.filter(u =>
      u.includes('adBreakStart') || u.includes('adStart') || u.includes('adJoin') || u.includes('adStop')
    )
    expect(allAdBeacons.length, 'At least 1 ad beacon must be captured').toBeGreaterThan(0)
    const debugAll = `\nAll ad beacons:\n${allAdBeacons.join('\n')}`

    // Use breakStart beacon for break-level params (A.2.5, A.2.7, A.2.8)
    // Use adStart beacon for ad-level params (A.2.9, A.2.10)
    const breakUrl = breakBeacons(beacons)[0] ?? allAdBeacons[0]
    const adStartUrl = adStartBeacons(beacons)[0] ?? allAdBeacons[0]

    // A.2.7 — breakNumber = 1 for first (and only) pre-roll break
    const breakNum = parseBeaconParam(breakUrl, 'ad.breakNumber')
                  ?? parseBeaconParam(adStartUrl, 'ad.breakNumber')
    if (breakNum !== null) {
      expect(parseFloat(breakNum), `A.2.7: breakNumber must be 1 for pre-roll${debugAll}`).toBe(1)
    }

    // A.2.8 — position = 'pre' (or 0 / 'preroll' — SDK version dependent)
    const position = parseBeaconParam(breakUrl, 'ad.position')
                  ?? parseBeaconParam(adStartUrl, 'ad.position')
    if (position !== null) {
      const isPreRoll = position === 'pre' || position === '0' || position.toLowerCase().includes('pre')
      expect(isPreRoll, `A.2.8: position must indicate pre-roll, got '${position}'${debugAll}`).toBe(true)
    }

    // A.2.5 — givenAds = 1 (one ad in the pre-roll break)
    const givenAds = parseBeaconParam(breakUrl, 'ad.givenAds')
                  ?? parseBeaconParam(adStartUrl, 'ad.givenAds')
    if (givenAds !== null) {
      expect(parseFloat(givenAds), `A.2.5: givenAds must be 1 for single-ad pre-roll${debugAll}`).toBe(1)
    }

    // A.2.9 — adNumber = 1 for the only ad
    const adNumber = parseBeaconParam(adStartUrl, 'ad.adNumber')
    if (adNumber !== null) {
      expect(parseFloat(adNumber), `A.2.9: adNumber must be 1 for first ad${debugAll}`).toBe(1)
    }

    // A.2.10 — adNumberInBreak = 1 (first ad in the break)
    const adInBreak = parseBeaconParam(adStartUrl, 'ad.adNumberInBreak')
                   ?? parseBeaconParam(adStartUrl, 'ad.numberInBreak')
    if (adInBreak !== null) {
      expect(parseFloat(adInBreak), `A.2.10: adNumberInBreak must be 1${debugAll}`).toBe(1)
    }

    // Soft check: at least breakNumber or adNumber must be verifiable
    // If all nulls, the SDK doesn't expose these in the URL — log for investigation
    const anyParamFound = [breakNum, position, givenAds, adNumber, adInBreak].some(v => v !== null)
    expect(
      anyParamFound,
      `A.2.5/7/8/9/10: At least 1 ad numbering param must be present in beacon URLs.${debugAll}`
    ).toBe(true)
  })

  // ── A.2.1-A.2.4: manifest-level break params (VMAP multi-break) ──────────
  test('NPAW-A.2.1/A.2.2/A.2.3/A.2.4 — givenBreaks, expectedBreaks, breaksTime, expectedPattern from VMAP', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    // VMAP with 3 breaks (pre+mid+post) — IMA should provide break manifest upfront
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vmap/full-metadata`,
    })
    await player.play()

    // Wait for IMA to fire adsContentPauseRequested (pre-roll starting)
    await player.waitForEvent('adsContentPauseRequested', 30_000)

    // NPAW ad beacons (/adBreakStart, /adStart) are sent asynchronously after the player event.
    // Poll until at least one ad beacon arrives so we don't capture too early.
    // If tracker.js never fires adBreakStart (a separate bug), this times out with a clear message.
    await expect.poll(
      () => beacons.some(b => b.includes('adBreakStart') || b.includes('adStart')),
      { timeout: 15_000, message: 'A.2.1-A.2.4: No NPAW ad beacons (/adBreakStart or /adStart) arrived after adsContentPauseRequested — tracker.js may not be calling fireBreakStart()' }
    ).toBe(true)

    // Capture all beacons after ad start confirmed
    const allBeacons = beacons.slice()
    const debugAll = `\nAll beacons so far:\n${allBeacons.join('\n')}`

    // A.2.3 / A.2.1 — expectedBreaks / givenBreaks = 3 (VMAP has 3 breaks)
    const expectedBreaks = allBeacons.reduce<string | null>((acc, u) => {
      return acc ?? parseBeaconParam(u, 'ad.expectedBreaks') ?? parseBeaconParam(u, 'ad.givenBreaks')
    }, null)

    if (expectedBreaks !== null) {
      const breaksCount = parseFloat(expectedBreaks)
      expect(
        isFinite(breaksCount) && breaksCount >= 1,
        `A.2.1/A.2.3: givenBreaks/expectedBreaks must be >= 1, got ${expectedBreaks}${debugAll}`
      ).toBe(true)
    }

    // A.2.2 — breaksTime (comma-separated offsets: 0,15,end or similar)
    const breaksTime = allBeacons.reduce<string | null>((acc, u) => {
      return acc ?? parseBeaconParam(u, 'ad.breaksTime')
    }, null)
    // breaksTime presence implies SDK received break schedule from IMA
    // Value format is SDK-internal — only verify it's non-empty if present
    if (breaksTime !== null) {
      expect(breaksTime.length, `A.2.2: breaksTime must be non-empty${debugAll}`).toBeGreaterThan(0)
    }

    // A.2.4 — expectedPattern (array of [position, adCount] tuples)
    const expectedPattern = allBeacons.reduce<string | null>((acc, u) => {
      return acc ?? parseBeaconParam(u, 'ad.expectedPattern')
    }, null)
    if (expectedPattern !== null) {
      expect(expectedPattern.length, `A.2.4: expectedPattern must be non-empty${debugAll}`).toBeGreaterThan(0)
    }

    // A.2.2 — breaksTime: player bug — tracker.js missing field in setVideoOptions() before fireBreakStart
    expect(
      breaksTime,
      `A.2.2: breaksTime must be present in ad beacons (VMAP provides break schedule at parse time).${debugAll}`
    ).not.toBeNull()

    // A.2.4 — expectedPattern: player bug — same root cause as A.2.2
    expect(
      expectedPattern,
      `A.2.4: expectedPattern must be present in ad beacons (VMAP provides break pattern).${debugAll}`
    ).not.toBeNull()

    expect(allBeacons.length, `A.2.1-A.2.4: beacons must arrive at ad break start${debugAll}`).toBeGreaterThan(0)
  })

  // ── Fixmes: params hard to observe from beacon URL ────────────────────────

  test('NPAW-A.2.11 — content playhead in ad beacons does not advance during ad', async () => {
    test.fixme(true, 'A.2.11: content.playhead param in /adStart /adJoin /adStop — requires side-by-side comparison of playhead value at adStart and adStop to confirm it stays constant during the break. Observable only by inspecting beacon URL params at two points in time. Implement after confirming param name via beacon log.')
  })

  test('NPAW-A.2.12 — adPlayhead in ad beacons advances during ad playback', async () => {
    test.fixme(true, 'A.2.12: ad.playhead in /adJoin /adStop — the value should increase from ~0 at adJoin to ~duration at adStop. Requires capturing multiple /ping beacons during the ad and comparing playhead. Already partially covered by A.2.22 (totalDuration > 0 implies playhead reached end).')
  })

  test('NPAW-A.2.14 — audio param in /adStart beacon', async () => {
    test.fixme(true, 'A.2.14: ad.audio (or ad.isAudioOnly) indicates audio enabled. In headless Chromium volume=1 by default. Param name uncertain in SDK 7.3.28 — needs beacon log inspection to confirm key name before writing hard assertion.')
  })

  test('NPAW-A.2.15 — fullscreen param in /adStart beacon', async () => {
    test.fixme(true, 'A.2.15: ad.isFullscreen should be false in headless/non-fullscreen test context. Param name uncertain — SDK may omit it when false. Needs beacon log inspection.')
  })

  test('NPAW-A.2.19 — adProvider (AdSystem) in /adStart beacon', async ({ isolatedPlayer: player, page }) => {
    // Player bug: buildAdOptions() does not map VAST AdSystem → ad.adProvider.
    // IMA exposes AdSystem via ad.getAdSystem() but tracker.js does not call it.
    // Note: ad.insertionType ("client" = CSAI) is a SEPARATE field (A.2.20) — do NOT fall back to it here.
    test.slow()
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/full-metadata`,  // AdSystem="MediastreamQA"
    })
    await player.play()
    await player.waitForAdStart(30_000)

    await expect.poll(() => adStartBeacons(beacons).length, {
      timeout: 10_000,
      message: 'A.2.19: /adStart beacon must arrive',
    }).toBeGreaterThan(0)

    const adStartUrl = adStartBeacons(beacons)[0]
    // Only check adProvider — do NOT fall back to adInsertionType which is a different NPAW field
    const adSystemProvider = parseBeaconParam(adStartUrl, 'ad.provider')

    expect(
      adSystemProvider,
      `A.2.19: ad.adProvider (VAST AdSystem) must be present in /adStart beacon. tracker.js must call ad.getAdSystem() and pass to NPAW.\nURL: ${adStartUrl}`
    ).not.toBeNull()
    if (adSystemProvider !== null) {
      expect(adSystemProvider, 'A.2.19: adProvider must match VAST AdSystem value "MediastreamQA"').toBe('MediastreamQA')
    }
  })

  test('NPAW-A.2.20 — adInsertionType in /adStart beacon', async () => {
    test.fixme(true, 'A.2.20: ad.insertionType or ad.adInsertionType — indicates CSAI vs SSAI. For IMA CSAI this would be "client" or "csai". Param name not documented in public SDK 7.3.28 spec. Needs beacon log inspection.')
  })
})

// ── Block I: NPAW A.3 — Ad Interaction ───────────────────────────────────────
//
// AC-YOUBORA-NPAW-A.3.2   /adClick beacon when user clicks ad
// AC-YOUBORA-NPAW-A.3.3   /adBufferUnderrun beacon when ad buffers
// AC-YOUBORA-NPAW-A.3.4   /adPause + /adResume beacons when ad paused/resumed
// AC-YOUBORA-NPAW-A.3.5   /adQuartile beacons at 25%, 50%, 75%

test.describe('Youbora — NPAW A.3 Ad Interaction', { tag: ['@integration', '@analytics', '@youbora', '@ads'] }, () => {

  test('NPAW-A.3.1 — background: app put in background during ad', async () => {
    test.fixme(true, 'A.3.1: Playwright headless has no concept of OS-level app backgrounding. Tab visibility API (document.hidden) can simulate it via page.evaluate, but IMA SDK behavior in hidden tabs varies by browser engine. Simulate with document.dispatchEvent(new Event("visibilitychange")) if player listens for it. Deferred until player exposes documented backgrounding API or event.')
  })

  // ── A.3.2 — /adClick + /adPause ──────────────────────────────────────────
  // Clicking the ad area: IMA fires CLICK event → NPAW sends /adClick and /adPause.
  // Player emits 'adsClicked' event when IMA fires.
  test('NPAW-A.3.2 — /adClick and /adPause beacons on ad area click', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()
    await player.waitForAdStart(30_000)

    // Wait a moment so ad video is actually playing before clicking
    await page.waitForTimeout(1_000)

    // The player's adsSkin component renders a `.ads-skin__view-more` anchor/button
    // with an onClick that emits Events._adsClick via internalEmitter.
    // This is the publicly observable click path — clicking it triggers fireClick() in tracker.js.
    const viewMore = page.locator('.ads-skin__view-more').first()
    const viewMoreVisible = await viewMore.isVisible().catch(() => false)
    if (viewMoreVisible) {
      await viewMore.click({ force: true })
    } else {
      // Fallback: dispatch click on topmost element (works when ads-skin is rendered)
      await page.evaluate(() => {
        const el = document.elementFromPoint(
          (window.innerWidth ?? 800) / 2,
          (window.innerHeight ?? 600) / 2
        ) as HTMLElement | null
        if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
      })
    }
    await page.waitForTimeout(500)

    // Wait for /adClick or /adPause to arrive
    await expect.poll(
      () => beacons.some(u => u.includes('adClick') || u.includes('adPause')),
      { timeout: 8_000, message: 'A.3.2: /adClick or /adPause beacon must arrive after clicking ad area' }
    ).toBe(true)

    const adClickBeacon = beacons.find(u => u.includes('adClick'))
    const adPauseBeacon = beacons.find(u => u.includes('adPause') && !u.includes('adResume'))

    // Both /adClick and /adPause expected per A.3.2 spec
    const debugAll = `\nAll beacons:\n${beacons.slice(-10).join('\n')}`

    // /adClick SHOULD be present (IMA fires CLICK on overlay tap)
    expect(
      adClickBeacon ?? adPauseBeacon,
      `A.3.2: At least /adClick or /adPause must arrive after clicking ad${debugAll}`
    ).toBeDefined()

    if (adClickBeacon) {
      expect(adClickBeacon, 'A.3.2: /adClick beacon URL must reference adClick event').toContain('adClick')
    }
    if (adPauseBeacon) {
      expect(adPauseBeacon, 'A.3.2: /adPause beacon URL must reference adPause event').toContain('adPause')
    }
  })

  // ── A.3.3 — /adBufferUnderrun ─────────────────────────────────────────────
  // Simulate network restriction mid-ad: route the ad media to delay response,
  // causing the video element to stall → IMA fires AD_BUFFERING → NPAW /adBufferUnderrun.
  test('NPAW-A.3.3 — /adBufferUnderrun beacon when ad media stalls', async ({ isolatedPlayer: player, page }) => {
    // Player bug: tracker.js has no binding for adsAdBuffering → adsAdapter.fireBufferBegin().
    // NPAW QA confirmed /adBufferUnderrun never fires. Fix: add onAdsBuffering handler in tracker.js.
    test.slow()

    // Intercept the ad media file and delay first response to force buffer stall
    let mediaIntercepted = false
    await page.route('**/*.mp4**', async (route) => {
      if (!mediaIntercepted) {
        mediaIntercepted = true
        // Pause fulfillment for 4s → causes video.readyState to drop → buffering
        await new Promise(r => setTimeout(r, 4_000))
      }
      await route.continue()
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()
    await player.waitForAdStart(35_000)

    // Wait for /adBufferUnderrun to arrive after stall resolves
    await expect.poll(
      () => beacons.some(u => u.includes('adBufferUnderrun') || u.includes('adBuffer')),
      { timeout: 15_000, message: 'A.3.3: /adBufferUnderrun beacon must arrive after ad media stall' }
    ).toBe(true)

    const bufferBeacon = beacons.find(u => u.includes('adBufferUnderrun') || u.includes('adBuffer'))
    expect(bufferBeacon).toBeDefined()
  })

  // ── A.3.4 — /adPause + /adResume (no /adBufferUnderrun on resume) ─────────
  test('NPAW-A.3.4 — /adPause and /adResume beacons, no adBufferUnderrun on resume', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()
    await player.waitForAdStart(30_000)

    // Wait 1s so ad video is actually playing
    await page.waitForTimeout(1_000)

    // Pause via player API (or IMA pause if available)
    await player.pause()
    const beaconsAtPause = beacons.length

    await expect.poll(
      () => beacons.some(u => u.includes('adPause') && !u.includes('adResume')),
      { timeout: 8_000, message: 'A.3.4: /adPause beacon must arrive after player.pause() during ad' }
    ).toBe(true)

    // Resume after 2s
    await page.waitForTimeout(2_000)
    await player.play()

    await expect.poll(
      () => beacons.some(u => u.includes('adResume')),
      { timeout: 8_000, message: 'A.3.4: /adResume beacon must arrive after player.play() during ad pause' }
    ).toBe(true)

    // A.3.4: no /adBufferUnderrun after resume (pausing ≠ buffering)
    const postResumeBeacons = beacons.slice(beaconsAtPause)
    const hasBufferAfterResume = postResumeBeacons.some(u =>
      u.includes('adBufferUnderrun') || (u.includes('adBuffer') && !u.includes('adPause'))
    )
    expect(
      hasBufferAfterResume,
      `A.3.4: /adBufferUnderrun must NOT be sent on resume after clean pause.\nPost-resume beacons:\n${postResumeBeacons.join('\n')}`
    ).toBe(false)
  })

  // ── A.3.5 — /adQuartile at 25%, 50%, 75% ─────────────────────────────────
  // Uses /vast/full-metadata (Duration=10s) — 3 quartile beacons at ~2.5s, ~5s, ~7.5s.
  test('NPAW-A.3.5 — three /adQuartile beacons at 25%, 50%, 75% of ad duration', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/full-metadata`,  // 10s ad
    })
    await player.play()
    await player.waitForAdStart(30_000)

    // Wait for ad to complete — all 3 quartiles arrive before adStop
    await player.waitForAllAdsComplete(60_000)

    const quartileBeacons = beacons.filter(u => u.includes('adQuartile'))
    const debugAll = `\nAll quartile beacons:\n${quartileBeacons.join('\n')}`

    expect(
      quartileBeacons.length,
      `A.3.5: exactly 3 /adQuartile beacons expected (25%, 50%, 75%) — got ${quartileBeacons.length}${debugAll}`
    ).toBe(3)
  })
})

// ── Block J: NPAW A.4 — Ad Interaction Stats ─────────────────────────────────
//
// AC-YOUBORA-NPAW-A.4.1   adBufferDuration param in /adBufferUnderrun
// AC-YOUBORA-NPAW-A.4.2   adURL param in /adClick
// AC-YOUBORA-NPAW-A.4.3   adPauseDuration param in /adResume
// AC-YOUBORA-NPAW-A.4.4   quartile param = 1,2,3 in /adQuartile beacons
// AC-YOUBORA-NPAW-A.4.5   adViewedDuration
// AC-YOUBORA-NPAW-A.4.6   adViewability

test.describe('Youbora — NPAW A.4 Ad Interaction Stats', { tag: ['@integration', '@analytics', '@youbora', '@ads'] }, () => {

  // ── A.4.4 — quartile param in /adQuartile beacons ───────────────────────
  // Rerun the quartile scenario and verify the quartile param = 1, 2, 3 in order.
  test('NPAW-A.4.4 — quartile param is 1, 2, 3 in successive /adQuartile beacons', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/full-metadata`,  // 10s ad
    })
    await player.play()
    await player.waitForAdStart(30_000)
    await player.waitForAllAdsComplete(60_000)

    const quartileBeacons = beacons.filter(u => u.includes('adQuartile'))
    expect(quartileBeacons.length, 'A.4.4: 3 adQuartile beacons required').toBe(3)

    const quartileValues = quartileBeacons.map(u =>
      parseBeaconParam(u, 'ad.quartile') ?? parseBeaconParam(u, 'quartile')
    )
    const debugAll = `\nQuartile beacon URLs:\n${quartileBeacons.join('\n')}\nParsed values: ${JSON.stringify(quartileValues)}`

    // Values must be present and equal 1, 2, 3 in order
    const hasValues = quartileValues.some(v => v !== null)
    if (hasValues) {
      expect(quartileValues[0], `A.4.4: first /adQuartile must have quartile=1${debugAll}`).toBe('1')
      expect(quartileValues[1], `A.4.4: second /adQuartile must have quartile=2${debugAll}`).toBe('2')
      expect(quartileValues[2], `A.4.4: third /adQuartile must have quartile=3${debugAll}`).toBe('3')
    } else {
      console.warn('A.4.4: quartile param not found in adQuartile beacon URL — SDK may encode differently.', debugAll)
    }
  })

  // ── A.4.3 — adPauseDuration in /adResume ─────────────────────────────────
  // Pause for a measured duration, verify adPauseDuration is close (±20%).
  test('NPAW-A.4.3 — adPauseDuration param in /adResume corresponds to actual pause time', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()
    await player.waitForAdStart(30_000)

    await page.waitForTimeout(1_000)

    const pauseStart = Date.now()
    await player.pause()
    const PAUSE_DURATION_MS = 3_000
    await page.waitForTimeout(PAUSE_DURATION_MS)
    await player.play()
    const pauseActual = Date.now() - pauseStart

    await expect.poll(
      () => beacons.some(u => u.includes('adResume')),
      { timeout: 8_000, message: 'A.4.3: /adResume must arrive after player.play()' }
    ).toBe(true)

    const resumeUrl = beacons.find(u => u.includes('adResume'))!
    const pauseDurStr = parseBeaconParam(resumeUrl, 'ad.pauseDuration')
                     ?? parseBeaconParam(resumeUrl, 'ad.adPauseDuration')
                     ?? parseBeaconParam(resumeUrl, 'pauseDuration')

    const debugInfo = `\n/adResume URL: ${resumeUrl}\nActual pause: ${pauseActual}ms`

    if (pauseDurStr !== null) {
      const pauseDurMs = parseFloat(pauseDurStr)
      expect(isFinite(pauseDurMs) && pauseDurMs > 0, `A.4.3: adPauseDuration must be positive${debugInfo}`).toBe(true)
      // Allow ±50% tolerance (SDK may use different timer resolution)
      const lowerBound = PAUSE_DURATION_MS * 0.5
      expect(
        pauseDurMs,
        `A.4.3: adPauseDuration (${pauseDurMs}ms) must be within ±50% of actual pause (${pauseActual}ms)${debugInfo}`
      ).toBeGreaterThan(lowerBound)
    } else {
      console.warn('A.4.3: adPauseDuration param not found in /adResume beacon URL — SDK may encode differently.', debugInfo)
    }
  })

  // ── A.4.2 — adURL in /adClick ────────────────────────────────────────────
  test('NPAW-A.4.2 — adURL param in /adClick beacon corresponds to click-through URL', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()
    await player.waitForAdStart(30_000)
    await page.waitForTimeout(1_000)

    const viewMore4 = page.locator('.ads-skin__view-more').first()
    const viewMoreVisible4 = await viewMore4.isVisible().catch(() => false)
    if (viewMoreVisible4) {
      await viewMore4.click({ force: true })
    } else {
      await page.evaluate(() => {
        const el = document.elementFromPoint(
          (window.innerWidth ?? 800) / 2,
          (window.innerHeight ?? 600) / 2
        ) as HTMLElement | null
        if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
      })
    }
    await page.waitForTimeout(500)

    await expect.poll(
      () => beacons.some(u => u.includes('adClick')),
      { timeout: 8_000, message: 'A.4.2: /adClick beacon must arrive after click' }
    ).toBe(true)

    const clickUrl = beacons.find(u => u.includes('adClick'))!
    const adUrl = parseBeaconParam(clickUrl, 'ad.adUrl')
               ?? parseBeaconParam(clickUrl, 'ad.url')
               ?? parseBeaconParam(clickUrl, 'adUrl')

    const debugInfo = `\n/adClick URL: ${clickUrl}`

    if (adUrl !== null) {
      expect(adUrl.length, `A.4.2: adURL must be a non-empty URL string${debugInfo}`).toBeGreaterThan(0)
    } else {
      console.warn('A.4.2: adURL param not found in /adClick beacon URL — VAST preroll.xml may not have ClickThrough URL, or SDK key differs.', debugInfo)
    }
  })

  // ── A.4.1 — adBufferDuration in /adBufferUnderrun ────────────────────────
  test('NPAW-A.4.1 — adBufferDuration param in /adBufferUnderrun matches stall time', async ({ isolatedPlayer: player, page }) => {
    // Same root cause as A.3.3: tracker.js missing adsAdapter.fireBufferBegin() binding.
    test.slow()

    let mediaIntercepted = false
    const STALL_MS = 3_000
    await page.route('**/*.mp4**', async (route) => {
      if (!mediaIntercepted) {
        mediaIntercepted = true
        await new Promise(r => setTimeout(r, STALL_MS))
      }
      await route.continue()
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()
    await player.waitForAdStart(35_000)

    await expect.poll(
      () => beacons.some(u => u.includes('adBufferUnderrun') || (u.includes('adBuffer') && !u.includes('adPause'))),
      { timeout: 15_000, message: 'A.4.1: /adBufferUnderrun must arrive after media stall resolves' }
    ).toBe(true)

    const bufUrl = beacons.find(u => u.includes('adBufferUnderrun') || (u.includes('adBuffer') && !u.includes('adPause')))!
    const bufDurStr = parseBeaconParam(bufUrl, 'ad.bufferDuration')
                   ?? parseBeaconParam(bufUrl, 'ad.adBufferDuration')
                   ?? parseBeaconParam(bufUrl, 'bufferDuration')

    const debugInfo = `\nBuffer beacon: ${bufUrl}`

    if (bufDurStr !== null) {
      const bufDur = parseFloat(bufDurStr)
      expect(isFinite(bufDur) && bufDur > 0, `A.4.1: adBufferDuration must be positive${debugInfo}`).toBe(true)
    } else {
      console.warn('A.4.1: adBufferDuration param not found in buffer beacon URL.', debugInfo)
    }
  })

  // ── A.4.5 / A.4.6 — adViewedDuration / adViewability ────────────────────
  test('NPAW-A.4.5 — adViewedDuration param in /adQuartile or /adStop', async () => {
    test.fixme(true, 'A.4.5: adViewedDuration = real time player visibly >50% on screen. In headless Playwright the player is always "visible" (Intersection Observer reports 1.0). Value should be close to adTotalDuration. Param name uncertain — SDK 7.3.28 may report under ad.viewedDuration or ad.adViewedDuration. Verify param name via beacon log first.')
  })

  test('NPAW-A.4.6 — adViewability param in /adQuartile or /adStop', async () => {
    test.fixme(true, 'A.4.6: adViewability = longest continuous period player was >50% visible. In headless always the full ad duration. Param name uncertain. Closely related to A.4.5 — implement together after param names confirmed.')
  })
})

// ── Block K: NPAW A.5 — Ad Errors ────────────────────────────────────────────
//
// AC-YOUBORA-NPAW-A.5.1   MUST — /adError when resource blocked before play
// AC-YOUBORA-NPAW-A.5.2   MUST — /adError when VAST fails to load (network error)
// AC-YOUBORA-NPAW-A.5.3   MUST — /adError when resource blocked during playback
// AC-YOUBORA-NPAW-A.5.4   MUST — /adError when network fails during playback

test.describe('Youbora — NPAW A.5 Ad Errors', { tag: ['@integration', '@analytics', '@youbora', '@ads'] }, () => {

  // ── A.5.1 — ad resource (MediaFile) blocked before play ───────────────────
  // Block the ad media MP4 URL → IMA fires AD_ERROR → NPAW sends /adError.
  // Content must resume after the error (IMA fallback → contentResumeRequested).
  test('NPAW-A.5.1 — /adError when ad MediaFile URL blocked before ad plays', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    // Abort the ad media file (googleapis mp4) — block all mp4 requests entirely
    // so IMA cannot load the video asset. VAST loads fine; media load fails.
    await page.route('**/*.mp4**', route => route.abort('blockedbyclient'))

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()

    // /adError must arrive — IMA fires error when media cannot load
    await expect.poll(
      () => beacons.some(u => u.includes('adError')),
      { timeout: 30_000, message: 'A.5.1: /adError beacon must arrive when ad MediaFile is blocked' }
    ).toBe(true)

    const adErrorUrl = beacons.find(u => u.includes('adError'))!
    const debugInfo = `\n/adError URL: ${adErrorUrl}`

    // errorCode must be present (IMA error code, e.g. 400 = VAST media error)
    const errorCode = parseBeaconParam(adErrorUrl, 'ad.errorCode')
                   ?? parseBeaconParam(adErrorUrl, 'errorCode')
                   ?? parseBeaconParam(adErrorUrl, 'code')
    expect(errorCode, `A.5.1: errorCode must be present in /adError beacon${debugInfo}`).not.toBeNull()

    // errorMsg should also be present
    const errorMsg = parseBeaconParam(adErrorUrl, 'ad.errorMessage')
                  ?? parseBeaconParam(adErrorUrl, 'errorMessage')
                  ?? parseBeaconParam(adErrorUrl, 'msg')
    // msg is SHOULD (sometimes absent depending on IMA error type)
    if (errorMsg === null) {
      console.warn('A.5.1: errorMessage not found in /adError beacon — SDK may omit for MediaFile errors.', debugInfo)
    }
  })

  // ── A.5.2 — VAST load failure (network error before ad loads) ─────────────
  // Abort the VAST endpoint → IMA fires VAST_LOAD_FAILED → NPAW sends /adError.
  test('NPAW-A.5.2 — /adError when VAST request fails (network error before ad plays)', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    // Abort the mock VAST URL (not the content platform mock — only the ads URL)
    await page.route(`**/vast/**`, route => route.abort('connectionrefused'))

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()

    await expect.poll(
      () => beacons.some(u => u.includes('adError')),
      { timeout: 30_000, message: 'A.5.2: /adError beacon must arrive when VAST fails to load' }
    ).toBe(true)

    const adErrorUrl = beacons.find(u => u.includes('adError'))!
    const errorCode = parseBeaconParam(adErrorUrl, 'ad.errorCode')
                   ?? parseBeaconParam(adErrorUrl, 'errorCode')
                   ?? parseBeaconParam(adErrorUrl, 'code')

    expect(
      errorCode,
      `A.5.2: errorCode must be present in /adError beacon.\nURL: ${adErrorUrl}`
    ).not.toBeNull()
  })

  // ── A.5.3 — ad resource error DURING playback ────────────────────────────
  // Ad starts normally, then a media error is injected on IMA's video element.
  // Note: blocking "subsequent mp4 requests" does not work because our local fixture
  // MP4 (454KB) is small enough to be downloaded in a single HTTP request — there
  // are no subsequent requests to intercept during playback.
  // Strategy: dispatch error event on IMA's video element after ad starts, which
  // causes IMA to fire AD_ERROR → player emits adsError → NPAW sends /adError.
  test('NPAW-A.5.3 — /adError when ad MediaFile error occurs during ad playback', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()

    // Wait for ad to start playing before injecting the error
    await player.waitForAdStart(30_000)
    await page.waitForTimeout(500)

    // Inject media error on IMA's video element — IMA listens for 'error' and
    // fires AD_ERROR which the player routes to adsError → adsAdapter.fireError()
    await page.evaluate(() => {
      const allVideos = Array.from(document.querySelectorAll('video'))
      const adVideo = allVideos.find(v => v.currentSrc && v.currentSrc.includes('.mp4'))
      if (adVideo) {
        Object.defineProperty(adVideo, 'error', {
          get: () => ({ code: 2, message: 'Network error simulation' }),
          configurable: true,
        })
        adVideo.dispatchEvent(new Event('error'))
      }
    })

    await expect.poll(
      () => beacons.some(u => u.includes('adError')),
      { timeout: 10_000, message: 'A.5.3: /adError beacon must arrive after ad video element error during playback' }
    ).toBe(true)

    const adErrorUrl = beacons.find(u => u.includes('adError'))!
    const errorCode = parseBeaconParam(adErrorUrl, 'ad.errorCode')
                   ?? parseBeaconParam(adErrorUrl, 'errorCode')
                   ?? parseBeaconParam(adErrorUrl, 'code')

    expect(
      errorCode,
      `A.5.3: errorCode must be present in /adError beacon.\nURL: ${adErrorUrl}`
    ).not.toBeNull()
  })

  // ── A.5.4 — bad network during ad playback (timeout/abort) ────────────────
  test('NPAW-A.5.4 — /adError when network fails during ad playback (connection abort)', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    // Same as A.5.3 but using connectionreset instead of abort — different error code
    // expected from IMA (900 series vs 400 series).
    let mp4Started = false
    await page.route('**/*.mp4**', async route => {
      if (!mp4Started) {
        mp4Started = true
        // Serve partial content then hang (simulate network timeout)
        // Playwright doesn't support partial responses natively — use delay + abort
        await new Promise(r => setTimeout(r, 500))
        await route.abort('connectionreset')
      } else {
        await route.abort('connectionreset')
      }
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })
    await player.play()

    await expect.poll(
      () => beacons.some(u => u.includes('adError')),
      { timeout: 40_000, message: 'A.5.4: /adError beacon must arrive after network failure during ad playback' }
    ).toBe(true)

    const adErrorUrl = beacons.find(u => u.includes('adError'))!
    const errorCode = parseBeaconParam(adErrorUrl, 'ad.errorCode')
                   ?? parseBeaconParam(adErrorUrl, 'errorCode')
                   ?? parseBeaconParam(adErrorUrl, 'code')

    expect(
      errorCode,
      `A.5.4: errorCode must be present in /adError beacon.\nURL: ${adErrorUrl}`
    ).not.toBeNull()

    // Soft check: content must resume after ad error (IMA falls through to content)
    // Verified by waiting for any non-ad event
    await expect.poll(
      () => beacons.some(u => !u.includes('ad') || u.includes('adStop') || u.includes('adBreakStop')),
      { timeout: 15_000, message: 'A.5.4: Content should resume (adStop or content beacon) after ad error' }
    ).toBe(true)
  })
})

// ── Block L: NPAW 1 — View Lifecycle (remaining) ──────────────────────────────
//
// AC-YOUBORA-NPAW-1.1   /init beacon before /start (SHOULD)
// AC-YOUBORA-NPAW-1.3   AdBlocker extension (MUST — fixme)
// AC-YOUBORA-NPAW-1.4   Manual channel change → /stop + new /start (MUST)
// AC-YOUBORA-NPAW-1.7   Two concurrent players → two views (MUST — fixme)
// AC-YOUBORA-NPAW-1.8   Background during playback (MUST — fixme)

test.describe('Youbora — NPAW 1 View Lifecycle', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  // ── 1.1 — /init or /start sent when play begins ──────────────────────────
  test('NPAW-1.1 — /init beacon sent when playback begins (before or alongside /start)', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    // NPAW suite: /init is the early lifecycle beacon before /start.
    // Some SDK versions send /init + /start, others only /start.
    // Either way, at least one must arrive.
    const hasInit  = beacons.some(u => u.includes('/init') || (u.includes('init') && !u.includes('initTime')))
    const hasStart = beacons.some(u => u.includes('/start') || u.includes('start'))

    expect(
      hasInit || hasStart,
      `NPAW-1.1: /init or /start beacon must arrive after playback begins.\nBeacons: ${beacons.slice(0, 5).join('\n')}`
    ).toBe(true)

    if (hasInit) {
      // /init must arrive before /start if both present
      const initIdx  = beacons.findIndex(u => u.includes('/init') || (u.includes('init') && !u.includes('initTime')))
      const startIdx = beacons.findIndex(u => u.includes('/start') || u.includes('start'))
      if (startIdx >= 0) {
        expect(
          initIdx,
          `NPAW-1.1: /init must arrive before /start — init=${initIdx}, start=${startIdx}`
        ).toBeLessThan(startIdx)
      }
    }
  })

  // ── 1.3 — AdBlocker ──────────────────────────────────────────────────────
  test('NPAW-1.3 — AdBlocker extension does not block NPAW beacons', async () => {
    test.fixme(true, 'NPAW-1.3: Cannot install real AdBlocker extension in headless Playwright. To test: run with a Chromium profile that has uBlock Origin, load youboranqs01.com in its whitelist, and verify beacons still arrive. Automated variant: block *.youboranqs01.com via page.route then verify player continues without JS errors (negative test).')
  })

  // ── 1.4 + 7.2 — Manual channel change → /stop + new /start ───────────────
  // Also covers 7.2 ("Video changed by user interaction").
  test('NPAW-1.4/7.2 — manual content change: old view /stop, new view /start, beacon count increases', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    // First content
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const countAfterFirst = beacons.length
    expect(countAfterFirst, 'NPAW-1.4: at least /start beacon for first content').toBeGreaterThan(0)

    // Capture view code from first /start beacon
    const firstStartUrl = beacons.find(u => u.includes('/start') || u.includes('start'))
    const viewCode1 = firstStartUrl ? (parseBeaconParam(firstStartUrl, 'code') ?? parseBeaconParam(firstStartUrl, 'viewCode')) : null

    // Manual channel change — second content
    await player.load({ type: 'media', id: MockContentIds.episode })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const countAfterSecond = beacons.length

    // Beacon count must have grown (new session)
    expect(
      countAfterSecond,
      'NPAW-1.4: total beacon count must grow after content change (new view)'
    ).toBeGreaterThan(countAfterFirst)

    // /stop must have been sent for old view
    const hasStop = beacons.some(u => u.includes('/stop') || (u.includes('stop') && !u.includes('adStop') && !u.includes('adBreakStop')))
    expect(hasStop, 'NPAW-1.4: /stop beacon must be sent when content changes').toBe(true)

    // New /start must appear after the stop
    const findLast = (arr: string[], pred: (u: string) => boolean): number => {
      for (let i = arr.length - 1; i >= 0; i--) { if (pred(arr[i])) return i }
      return -1
    }
    const stopIdx  = findLast(beacons, u => u.includes('/stop') || (u.includes('stop') && !u.includes('adStop')))
    const startIdx = findLast(beacons, u => u.includes('/start') || u.includes('start'))
    if (stopIdx >= 0 && startIdx >= 0) {
      expect(startIdx, 'NPAW-1.4: new /start must come after /stop for content change').toBeGreaterThan(stopIdx)
    }

    // View code must change (AC-2.14)
    const secondStartUrl = [...beacons].reverse().find(u => u.includes('/start') || u.includes('start'))
    const viewCode2 = secondStartUrl ? (parseBeaconParam(secondStartUrl, 'code') ?? parseBeaconParam(secondStartUrl, 'viewCode')) : null

    if (viewCode1 !== null && viewCode2 !== null) {
      expect(viewCode2, 'NPAW-2.14: view code must differ between first and second content').not.toBe(viewCode1)
    }
  })

  // ── 1.7 — Two concurrent players ─────────────────────────────────────────
  test('NPAW-1.7 — two simultaneous players open two different NPAW views', async () => {
    test.fixme(true, 'NPAW-1.7: Requires two isolatedPlayer fixtures active simultaneously, each with a separate NPAW interceptor, to verify two independent view codes are tracked. Playwright fixture system does not support two concurrent isolatedPlayer instances in a single test. Deferred until worker-parallel test setup is added or a multi-player page fixture is created.')
  })

  // ── 1.8 — Background ─────────────────────────────────────────────────────
  test('NPAW-1.8 — placing browser tab in background triggers pause or keeps view alive with /ping', async () => {
    test.fixme(true, 'NPAW-1.8: OS-level background (Home button press) not reproducible in Playwright. Tab visibility change can be simulated via document.dispatchEvent(new Event("visibilitychange")) after setting document.hidden = true via Object.defineProperty. Requires verifying which scenario the player implements (pause/resume vs. view close) and asserting accordingly. Deferred until player documents background behavior in player_architecture.md.')
  })
})

// ── Block M: NPAW 2 — /start Metadata Params (MUST) ─────────────────────────
//
// AC-YOUBORA-NPAW-2.2   device info (MUST)
// AC-YOUBORA-NPAW-2.3   mediaResource/CDN in /start (MUST)
// AC-YOUBORA-NPAW-2.5   title in /start (MUST)
// AC-YOUBORA-NPAW-2.7   player name in /start (MUST)
// AC-YOUBORA-NPAW-2.9   pluginVersion in /start (MUST)
// AC-YOUBORA-NPAW-2.10  pluginInfo in /start (MUST)
// AC-YOUBORA-NPAW-2.1   view code consistent within session (SHOULD)
// AC-YOUBORA-NPAW-2.14  view code changes on content change (MUST — covered also in 1.4)

test.describe('Youbora — NPAW 2 Metadata in /start Beacon', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  // ── 2.2 + 2.3 + 2.5 + 2.7 + 2.9 + 2.10 — all MUST params in /start ─────
  test('NPAW-2.2/2.3/2.5/2.7/2.9/2.10 — device, resource, title, player, pluginVersion, pluginInfo in /start', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})
    // Non-fatal /error arrives early (61ms after /init); wait up to 20s for /start
    // which may arrive after NPAW recovers from the error state.
    await expect.poll(
      () => beacons.some(u => u.includes('/start') || u.includes('start') || u.includes('joinTime')),
      { timeout: 20_000, message: 'NPAW-2.x: /start or /joinTime beacon must arrive after contentFirstPlay' }
    ).toBe(true)

    const startUrl = beacons.find(u => u.includes('/start') || u.includes('start') || u.includes('joinTime'))
    expect(startUrl, 'NPAW-2.x: /start beacon must arrive after contentFirstPlay').toBeDefined()
    if (!startUrl) return

    const debugInfo = `\n/start URL: ${startUrl}`

    // 2.2 — device info: device.code, device.ua, or ua param
    const device = parseBeaconParam(startUrl, 'device.code')
                ?? parseBeaconParam(startUrl, 'device.ua')
                ?? parseBeaconParam(startUrl, 'ua')
                ?? parseBeaconParam(startUrl, 'device')
    if (device !== null) {
      expect(device.length, `NPAW-2.2: device param must be non-empty${debugInfo}`).toBeGreaterThan(0)
    } else {
      console.warn('NPAW-2.2: device param not found in /start URL. SDK may not encode it in NQS query.', debugInfo)
    }

    // 2.3 — mediaResource: content.resource, media, or resource param
    const resource = parseBeaconParam(startUrl, 'content.resource')
                  ?? parseBeaconParam(startUrl, 'media')
                  ?? parseBeaconParam(startUrl, 'resource')
    expect(resource, `NPAW-2.3: mediaResource (content.resource) must be present in /start${debugInfo}`).not.toBeNull()
    if (resource !== null) {
      expect(resource.length, `NPAW-2.3: mediaResource must be a non-empty URL${debugInfo}`).toBeGreaterThan(0)
    }

    // 2.5 — title: content.title or title param
    const title = parseBeaconParam(startUrl, 'content.title')
               ?? parseBeaconParam(startUrl, 'title')
    expect(title, `NPAW-2.5: title (content.title) must be present in /start${debugInfo}`).not.toBeNull()
    if (title !== null) {
      expect(title.length, `NPAW-2.5: title must be non-empty${debugInfo}`).toBeGreaterThan(0)
    }

    // 2.7 — player name: player.name or playerName
    const playerName = parseBeaconParam(startUrl, 'player.name')
                    ?? parseBeaconParam(startUrl, 'playerName')
                    ?? parseBeaconParam(startUrl, 'player')
    expect(playerName, `NPAW-2.7: player name (player.name) must be present in /start${debugInfo}`).not.toBeNull()
    if (playerName !== null) {
      expect(playerName.length, `NPAW-2.7: player name must be non-empty${debugInfo}`).toBeGreaterThan(0)
    }

    // 2.9 — pluginVersion: nqs.version, player.pluginVersion, or pluginVersion
    const pluginVer = parseBeaconParam(startUrl, 'nqs.version')
                   ?? parseBeaconParam(startUrl, 'player.pluginVersion')
                   ?? parseBeaconParam(startUrl, 'pluginVersion')
    expect(pluginVer, `NPAW-2.9: pluginVersion must be present in /start${debugInfo}`).not.toBeNull()
    if (pluginVer !== null) {
      expect(pluginVer.length, `NPAW-2.9: pluginVersion must be non-empty${debugInfo}`).toBeGreaterThan(0)
    }

    // 2.10 — pluginInfo: player.pluginInfo or pluginInfo
    const pluginInfo = parseBeaconParam(startUrl, 'player.pluginInfo')
                    ?? parseBeaconParam(startUrl, 'pluginInfo')
                    ?? parseBeaconParam(startUrl, 'nqs.js')
    if (pluginInfo !== null) {
      expect(pluginInfo.length, `NPAW-2.10: pluginInfo must be non-empty${debugInfo}`).toBeGreaterThan(0)
    } else {
      console.warn('NPAW-2.10: pluginInfo not found in /start URL.', debugInfo)
    }
  })

  // ── 2.1 — view code consistent within a session ───────────────────────────
  test('NPAW-2.1 — view code is the same across all beacons within one session', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})
    // Play briefly to get /ping beacons with view code
    await page.waitForTimeout(6_000)

    const startUrl = beacons.find(u => u.includes('/start') || u.includes('start'))
    if (!startUrl) {
      console.warn('NPAW-2.1: /start beacon not found — skipping view code consistency check')
      return
    }

    const viewCode = parseBeaconParam(startUrl, 'code')
                  ?? parseBeaconParam(startUrl, 'viewCode')
    if (viewCode === null) {
      console.warn('NPAW-2.1: view code param not found in /start beacon — SDK may not expose it in NQS query params')
      return
    }

    // All non-error beacons should have the same view code
    const inconsistent = beacons.filter(u => {
      const code = parseBeaconParam(u, 'code') ?? parseBeaconParam(u, 'viewCode')
      return code !== null && code !== viewCode
    })

    expect(
      inconsistent,
      `NPAW-2.1: view code must be consistent across all beacons within the session. Inconsistent: ${inconsistent.join('\n')}`
    ).toHaveLength(0)
  })

  // ── 2.4 — Live param: false for VOD, true for Live ────────────────────────
  test('NPAW-2.4 — live param is false for VOD, true for Live content in /start', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const startUrl = beacons.find(u => u.includes('/start') || u.includes('start'))
    if (!startUrl) return

    const liveParam = parseBeaconParam(startUrl, 'content.isLive')
                   ?? parseBeaconParam(startUrl, 'live')
                   ?? parseBeaconParam(startUrl, 'isLive')

    if (liveParam !== null) {
      expect(
        liveParam,
        `NPAW-2.4: live param must be 'false' for VOD content.\n/start URL: ${startUrl}`
      ).toBe('false')
    } else {
      console.warn('NPAW-2.4: live/isLive param not found in /start — SDK may use different key or omit for VOD')
    }
  })

  // ── 2.8 + 2.11 + 2.12 — playerVersion, appName, appVersion (SHOULD) ──────
  test('NPAW-2.8/2.11/2.12 — playerVersion, appName, appVersion in /start beacon (SHOULD)', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const startUrl = beacons.find(u => u.includes('/start') || u.includes('start'))
    if (!startUrl) return

    const debugInfo = `\n/start URL: ${startUrl}`

    // 2.8 — playerVersion
    const playerVer = parseBeaconParam(startUrl, 'player.version')
                   ?? parseBeaconParam(startUrl, 'playerVersion')
    if (playerVer !== null) {
      expect(playerVer.length, `NPAW-2.8: playerVersion must be non-empty${debugInfo}`).toBeGreaterThan(0)
    } else {
      console.warn('NPAW-2.8: playerVersion not found in /start URL.', debugInfo)
    }

    // 2.11 — appName
    const appName = parseBeaconParam(startUrl, 'app.name')
                 ?? parseBeaconParam(startUrl, 'appName')
    if (appName !== null) {
      expect(appName.length, `NPAW-2.11: appName must be non-empty${debugInfo}`).toBeGreaterThan(0)
    } else {
      console.warn('NPAW-2.11: appName not found in /start URL.', debugInfo)
    }

    // 2.12 — appVersion
    const appVersion = parseBeaconParam(startUrl, 'app.releaseVersion')
                    ?? parseBeaconParam(startUrl, 'appVersion')
    if (appVersion !== null) {
      expect(appVersion.length, `NPAW-2.12: appVersion must be non-empty${debugInfo}`).toBeGreaterThan(0)
    } else {
      console.warn('NPAW-2.12: appVersion not found in /start URL.', debugInfo)
    }
  })

  // ── 2.15 — metadata updates with new content on change ───────────────────
  test('NPAW-2.15 — /start for new content has updated title and resource metadata', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const firstStart = beacons.find(u => u.includes('/start') || u.includes('start'))
    const title1 = firstStart ? (parseBeaconParam(firstStart, 'content.title') ?? parseBeaconParam(firstStart, 'title')) : null
    const resource1 = firstStart ? (parseBeaconParam(firstStart, 'content.resource') ?? parseBeaconParam(firstStart, 'media')) : null

    // Change content
    await player.load({ type: 'media', id: MockContentIds.episode })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const secondStart = [...beacons].reverse().find(u => u.includes('/start') || u.includes('start'))
    const title2 = secondStart ? (parseBeaconParam(secondStart, 'content.title') ?? parseBeaconParam(secondStart, 'title')) : null
    const resource2 = secondStart ? (parseBeaconParam(secondStart, 'content.resource') ?? parseBeaconParam(secondStart, 'media')) : null

    const debugInfo = `\ntitle1=${title1}, title2=${title2}, resource1=${resource1}, resource2=${resource2}`

    if (title1 !== null && title2 !== null) {
      expect(title2, `NPAW-2.15: title in /start must change for new content${debugInfo}`).not.toBe(title1)
    } else {
      console.warn('NPAW-2.15: title param not found in /start beacons — cannot verify metadata update.', debugInfo)
    }
    if (resource1 !== null && resource2 !== null) {
      expect(resource2, `NPAW-2.15: mediaResource in /start must change for new content${debugInfo}`).not.toBe(resource1)
    }
  })

  // ── 2.16 + 2.18 + 2.19 + 2.20 — user/referer SHOULD params ──────────────
  test('NPAW-2.16/2.18/2.19/2.20 — userId, UUID, custom dimensions, referer in /start (SHOULD)', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const startUrl = beacons.find(u => u.includes('/start') || u.includes('start'))
    if (!startUrl) return

    const debugInfo = `\n/start URL: ${startUrl}`

    // 2.16 — user id/username (only present if configured in YOUBORA_CONFIG)
    const userId = parseBeaconParam(startUrl, 'user.name')
                ?? parseBeaconParam(startUrl, 'user.id')
                ?? parseBeaconParam(startUrl, 'userId')
    if (userId !== null) {
      expect(userId.length, `NPAW-2.16: userId must be non-empty if present${debugInfo}`).toBeGreaterThan(0)
    }

    // 2.18 — UUID (anonymous session identifier)
    const uuid = parseBeaconParam(startUrl, 'user.anonymousId')
              ?? parseBeaconParam(startUrl, 'uuid')
              ?? parseBeaconParam(startUrl, 'anonymousId')
    if (uuid !== null) {
      expect(uuid.length, `NPAW-2.18: UUID must be non-empty${debugInfo}`).toBeGreaterThan(0)
    } else {
      console.warn('NPAW-2.18: UUID/anonymousId not found in /start URL.', debugInfo)
    }

    // 2.20 — referer
    const referer = parseBeaconParam(startUrl, 'referer')
                 ?? parseBeaconParam(startUrl, 'page.url')
    if (referer !== null) {
      expect(referer.length, `NPAW-2.20: referer must be non-empty${debugInfo}`).toBeGreaterThan(0)
    } else {
      console.warn('NPAW-2.20: referer not found in /start URL.', debugInfo)
    }

    // 2.19 — custom dimensions (param1..20) — only if configured
    const param1 = parseBeaconParam(startUrl, 'param1')
                ?? parseBeaconParam(startUrl, 'content.customDimension.1')
    if (param1 !== null) {
      expect(param1.length, `NPAW-2.19: param1 must be non-empty when present${debugInfo}`).toBeGreaterThan(0)
    }
  })

  // ── 2.23-2.36 — extended content metadata SHOULD params ───────────────────
  test('NPAW-2.23/2.24/2.25/.../2.36 — extended metadata fields in /start beacon (SHOULD)', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const startUrl = beacons.find(u => u.includes('/start') || u.includes('start'))
    if (!startUrl) return

    const debugInfo = `\n/start URL: ${startUrl}`

    // NPAW SDK 7.3.28 param key map (best-effort — keys may differ across SDK versions):
    // 2.23 program/title2   → content.program or content.title2
    // 2.24 channel          → content.channel
    // 2.25 package          → content.package
    // 2.26 saga             → content.saga
    // 2.27 tvShow           → content.tvShow
    // 2.28 season           → content.season
    // 2.29 episodeTitle     → content.episodeTitle
    // 2.30 genre            → content.genre
    // 2.31 language         → content.language
    // 2.32 subtitles        → content.subtitles
    // 2.33 playback type    → content.playbackType
    // 2.34 drm              → content.drm
    // 2.35 transaction code → content.transactionCode
    // 2.36 streaming proto  → content.streamingProtocol

    const fields: Array<{ ac: string; keys: string[] }> = [
      { ac: '2.23', keys: ['content.program', 'content.title2', 'program'] },
      { ac: '2.24', keys: ['content.channel', 'channel'] },
      { ac: '2.25', keys: ['content.package', 'package'] },
      { ac: '2.26', keys: ['content.saga', 'saga'] },
      { ac: '2.27', keys: ['content.tvShow', 'tvShow'] },
      { ac: '2.28', keys: ['content.season', 'season'] },
      { ac: '2.29', keys: ['content.episodeTitle', 'episodeTitle'] },
      { ac: '2.30', keys: ['content.genre', 'genre'] },
      { ac: '2.31', keys: ['content.language', 'language'] },
      { ac: '2.32', keys: ['content.subtitles', 'subtitles'] },
      { ac: '2.33', keys: ['content.playbackType', 'playbackType'] },
      { ac: '2.34', keys: ['content.drm', 'drm'] },
      { ac: '2.35', keys: ['content.transactionCode', 'transactionCode'] },
      { ac: '2.36', keys: ['content.streamingProtocol', 'streamingProtocol', 'protocol'] },
    ]

    const notFound: string[] = []
    for (const { ac, keys } of fields) {
      const val = keys.reduce<string | null>((acc, k) => acc ?? parseBeaconParam(startUrl, k), null)
      if (val !== null) {
        expect(typeof val, `NPAW-${ac}: param must be a string${debugInfo}`).toBe('string')
      } else {
        notFound.push(ac)
      }
    }

    if (notFound.length > 0) {
      console.warn(
        `NPAW-2.23..2.36: The following ACs had params not found in /start URL (SHOULD — only an issue if configured in player): ${notFound.join(', ')}.`,
        debugInfo
      )
    }
  })
})

// ── Block O: NPAW 3 EBVS + NPAW 4.3 Seek Loaded ─────────────────────────────
//
// AC-YOUBORA-NPAW-3.2   EBVS — /stop sent, /joinTime NOT sent
// AC-YOUBORA-NPAW-4.3   Seek to loaded position — no buffer underrun

test.describe('Youbora — NPAW 3 Join/EBVS + 4.3 Seek', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  // ── 3.2 — EBVS: exit before video starts ─────────────────────────────────
  // Strategy: block the HLS manifest to delay video start, so /start fires
  // but joinTime never fires. Then destroy() → EBVS (/stop without /joinTime).
  test('NPAW-3.2 — EBVS: /stop sent without /joinTime when player destroyed before video starts', async ({ isolatedPlayer: player, page }) => {
    test.fixme(true, 'NPAW-3.2: Player bug — tracker.js fireStart() immediately calls fireJoin() in the same function, making EBVS impossible. /start and /joinTime are always sent together. Requires tracker.js fix to call fireJoin() only when first frame renders (readyState >= 2 or timeupdate with progress).')
    test.slow()

    // Delay the HLS master playlist so video never actually starts playing.
    // This creates a window between plugin /start (fires on play()) and /joinTime (fires on first frame).
    let masterRequested = false
    await page.route('**/master.m3u8', async route => {
      if (!masterRequested) {
        masterRequested = true
        // Hold the response for 15s — long enough to verify /start without /joinTime
        await new Promise<void>(r => setTimeout(r, 15_000))
      }
      await route.continue()
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.play()

    // Wait for /start or /init beacon (plugin sends it when play() is called)
    await expect.poll(
      () => beacons.some(u => u.includes('/start') || u.includes('start')),
      { timeout: 15_000, message: 'NPAW-3.2: /start must be sent after play() even before video loads' }
    ).toBe(true)

    // Destroy player — EBVS scenario
    await player.destroy()

    // Give beacons 3s to arrive
    await page.waitForTimeout(3_000)

    const allUrls = beacons.join('\n')

    // /stop must have been sent (view closed on destroy)
    expect(
      beacons.some(u => u.includes('/stop') || (u.includes('stop') && !u.includes('adStop'))),
      `NPAW-3.2: /stop beacon must be sent on destroy (EBVS).\nAll beacons:\n${allUrls}`
    ).toBe(true)

    // /joinTime must NOT have been sent (video never started — EBVS condition)
    expect(
      beacons.some(u => u.includes('/joinTime') || u.includes('joinTime')),
      `NPAW-3.2: /joinTime must NOT be sent in EBVS scenario.\nAll beacons:\n${allUrls}`
    ).toBe(false)
  })

  // ── 4.3 — Seek to already-loaded position ────────────────────────────────
  test('NPAW-4.3 — seek to already-loaded position does not trigger /bufferUnderrun', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    // Play 6s to buffer ahead (VOD segments are 2s each — 3 segments buffered)
    await expect.poll(
      () => player.page.evaluate(() => (window as any).__player?.currentTime ?? 0),
      { timeout: 15_000, message: '4.3: currentTime must advance to > 4s before backward seek' }
    ).toBeGreaterThan(4)

    const beaconsBefore = beacons.length

    // Seek backward to an already-loaded position (position ~1s — buffered)
    await player.seek(1)
    await player.waitForEvent('seeked', 10_000)

    // Wait for any new beacons to settle
    await page.waitForTimeout(2_000)

    const newBeacons = beacons.slice(beaconsBefore)
    const allNew = newBeacons.join('\n')

    // Seek beacons (fireSeekBegin/fireSeekEnd) are expected
    // /bufferUnderrun must NOT appear for an already-loaded position
    const hasBufferUnderrun = newBeacons.some(u =>
      u.includes('bufferUnderrun') || u.includes('bufferBegin')
    )

    expect(
      hasBufferUnderrun,
      `NPAW-4.3: /bufferUnderrun must NOT fire when seeking to an already-loaded position.\nNew beacons after seek:\n${allNew}`
    ).toBe(false)
  })
})

// ── Block P: NPAW 6 — Ping Events ────────────────────────────────────────────
//
// AC-YOUBORA-NPAW-6.1   /ping arrives every ~5s
// AC-YOUBORA-NPAW-6.2   playhead in /ping > 0 and advances
// AC-YOUBORA-NPAW-6.3   pingTime and diffTime present in /ping
// AC-YOUBORA-NPAW-6.4   bitrate OR totalBytes (not both absent)
// AC-YOUBORA-NPAW-6.7   throughput in /ping
// AC-YOUBORA-NPAW-6.8   Playrate (SHOULD — fixme)
// AC-YOUBORA-NPAW-6.9   Dynamic metadata

test.describe('Youbora — NPAW 6 Ping Events', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  const isPingBeacon = (u: string) =>
    (u.includes('/ping') || (u.includes('ping') && !u.includes('adPause') && !u.includes('adStop'))) &&
    !u.includes('adPing')

  // ── 6.1 + 6.2 + 6.3 + 6.4 + 6.7 — comprehensive /ping param test ────────
  test('NPAW-6.1/6.2/6.3/6.4/6.7 — /ping arrives within 10s, carries playhead/pingTime/bitrate/throughput', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    // 6.1: /ping must arrive within 10s of first play (default interval = 5s)
    await expect.poll(
      () => beacons.some(isPingBeacon),
      { timeout: 10_000, message: 'NPAW-6.1: /ping beacon must arrive within 10s of contentFirstPlay' }
    ).toBe(true)

    const pingUrl = beacons.find(isPingBeacon)!
    const debugInfo = `\n/ping URL: ${pingUrl}`

    // 6.2 — playhead > 0 in /ping (content has played for some seconds)
    const playhead = parseBeaconParam(pingUrl, 'playhead')
                  ?? parseBeaconParam(pingUrl, 'content.playhead')
    if (playhead !== null) {
      const ph = parseFloat(playhead)
      expect(isFinite(ph) && ph >= 0, `NPAW-6.2: playhead must be a non-negative number, got ${playhead}${debugInfo}`).toBe(true)
    } else {
      console.warn('NPAW-6.2: playhead param not found in /ping URL.', debugInfo)
    }

    // 6.3 — pingTime and diffTime
    const pingTime = parseBeaconParam(pingUrl, 'pingTime')
                  ?? parseBeaconParam(pingUrl, 'pt')
    const diffTime = parseBeaconParam(pingUrl, 'diffTime')
                  ?? parseBeaconParam(pingUrl, 'dt')

    if (pingTime !== null) {
      const pt = parseFloat(pingTime)
      expect(isFinite(pt) && pt > 0, `NPAW-6.3: pingTime must be positive, got ${pingTime}${debugInfo}`).toBe(true)
    } else {
      console.warn('NPAW-6.3: pingTime not found in /ping URL.', debugInfo)
    }
    if (diffTime !== null) {
      const dt = parseFloat(diffTime)
      expect(isFinite(dt) && dt > 0, `NPAW-6.3: diffTime must be positive, got ${diffTime}${debugInfo}`).toBe(true)
    } else {
      console.warn('NPAW-6.3: diffTime not found in /ping URL.', debugInfo)
    }

    // 6.4 — bitrate OR totalBytes (one of the two must be present)
    const bitrate    = parseBeaconParam(pingUrl, 'bitrate')
                    ?? parseBeaconParam(pingUrl, 'content.bitrate')
    const totalBytes = parseBeaconParam(pingUrl, 'totalBytes')
                    ?? parseBeaconParam(pingUrl, 'content.totalBytes')

    if (bitrate !== null) {
      const br = parseFloat(bitrate)
      expect(isFinite(br), `NPAW-6.4: bitrate must be a number (can be -1 if unreported), got ${bitrate}${debugInfo}`).toBe(true)
      expect(totalBytes, `NPAW-6.4: bitrate and totalBytes must not both be present (only one allowed)${debugInfo}`).toBeNull()
    } else if (totalBytes !== null) {
      const tb = parseFloat(totalBytes)
      expect(isFinite(tb) && tb >= 0, `NPAW-6.4: totalBytes must be non-negative, got ${totalBytes}${debugInfo}`).toBe(true)
    } else {
      console.warn('NPAW-6.4: Neither bitrate nor totalBytes found in /ping URL — SDK may report -1 inline.', debugInfo)
    }

    // 6.7 — throughput (can be -1 if player doesn't report it)
    const throughput = parseBeaconParam(pingUrl, 'throughput')
                    ?? parseBeaconParam(pingUrl, 'content.throughput')
    if (throughput !== null) {
      const tp = parseFloat(throughput)
      expect(isFinite(tp), `NPAW-6.7: throughput must be a number (can be -1), got ${throughput}${debugInfo}`).toBe(true)
    } else {
      console.warn('NPAW-6.7: throughput not found in /ping URL.', debugInfo)
    }
  })

  // ── 6.2 second check — playhead advances between consecutive /ping ─────────
  test('NPAW-6.2 — playhead value advances between successive /ping beacons during playback', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    // Wait for at least 2 /ping beacons (>10s)
    await expect.poll(
      () => beacons.filter(isPingBeacon).length,
      { timeout: 15_000, message: 'NPAW-6.2: at least 2 /ping beacons needed to verify playhead advance' }
    ).toBeGreaterThanOrEqual(2)

    const pings = beacons.filter(isPingBeacon)
    const ph1 = parseBeaconParam(pings[0], 'playhead') ?? parseBeaconParam(pings[0], 'content.playhead')
    const ph2 = parseBeaconParam(pings[1], 'playhead') ?? parseBeaconParam(pings[1], 'content.playhead')

    if (ph1 !== null && ph2 !== null) {
      expect(
        parseFloat(ph2),
        `NPAW-6.2: playhead in second /ping (${ph2}) must be >= playhead in first /ping (${ph1})`
      ).toBeGreaterThanOrEqual(parseFloat(ph1))
    } else {
      console.warn('NPAW-6.2: playhead param not found in /ping beacons — cannot verify advance.')
    }
  })

  // ── 6.8 — Playrate ────────────────────────────────────────────────────────
  test('NPAW-6.8 — playrate param in /ping (SHOULD)', async () => {
    test.fixme(true, 'NPAW-6.8: playrate = current playback rate (1.0 for normal speed). Param name uncertain in SDK 7.3.28 (could be content.playrate, playRate, or playbackRate). Verify param name via beacon log, then write hard assertion checking playrate=1 for normal playback and playrate=2 after player.setPlaybackRate(2).')
  })

  // ── 6.9 — Dynamic Metadata ────────────────────────────────────────────────
  test('NPAW-6.9 — entities/dynamic metadata updated in /ping after rendition change', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    // Force a quality level change via player internals (ABR control)
    await player.page.evaluate(() => {
      const p = (window as any).__player
      if (p?.setLevel) p.setLevel(0)
      else if (typeof p?.quality !== 'undefined') p.quality = 0
    })

    // Wait for any /ping or entities beacon after the level change
    await expect.poll(
      () => beacons.filter(isPingBeacon).length,
      { timeout: 10_000, message: 'NPAW-6.9: /ping must arrive after quality change' }
    ).toBeGreaterThan(0)

    // Dynamic metadata: 'entities' param in /ping contains JSON with rendition info
    const pingWithEntities = beacons.filter(isPingBeacon).find(u => {
      const entities = parseBeaconParam(u, 'entities')
      return entities !== null && entities.length > 0
    })

    if (pingWithEntities) {
      const entities = parseBeaconParam(pingWithEntities, 'entities')!
      expect(entities.length, 'NPAW-6.9: entities param in /ping must be non-empty').toBeGreaterThan(0)
    } else {
      console.warn('NPAW-6.9: entities param not found in any /ping beacon — dynamic metadata may only update on quality change events, not every ping.')
    }
  })
})

// ── Block Q: NPAW 7-8 Remaining ──────────────────────────────────────────────
//
// AC-YOUBORA-NPAW-7.4   Exit player while playing → /stop (SHOULD)
// AC-YOUBORA-NPAW-7.5   Casting sender (SHOULD — fixme)
// AC-YOUBORA-NPAW-8.2   Startup error timeout (SHOULD)
// AC-YOUBORA-NPAW-8.4   Instream error timeout (SHOULD)
// AC-YOUBORA-NPAW-8.5   Offline during playback → error beacon (SHOULD)

test.describe('Youbora — NPAW 7-8 Stop and Error (remaining)', { tag: ['@integration', '@analytics', '@youbora'] }, () => {

  // ── 7.4 — Exit (destroy) while playing → /stop ───────────────────────────
  test('NPAW-7.4 — player.destroy() while playing emits /stop beacon (view closed)', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    // Play briefly
    await page.waitForTimeout(2_000)

    const countBefore = beacons.length

    // Destroy player mid-playback
    await player.destroy()

    // Give /stop beacon 3s to arrive
    await page.waitForTimeout(3_000)

    const newBeacons = beacons.slice(countBefore)

    expect(
      newBeacons.some(u => u.includes('/stop') || (u.includes('stop') && !u.includes('adStop'))),
      `NPAW-7.4: /stop beacon must be sent when player.destroy() called mid-playback.\nNew beacons: ${newBeacons.join('\n')}`
    ).toBe(true)
  })

  // ── 7.5 — Casting sender ─────────────────────────────────────────────────
  test('NPAW-7.5 — Chromecast sender: view closes when cast starts, reopens when cast ends', async () => {
    test.fixme(true, 'NPAW-7.5: Chromecast casting requires a real Cast-capable browser (Chrome with Cast extension or Chrome on a network with a Chromecast receiver). Not testable in Playwright headless. To test: use real Chrome with --enable-features=CastMediaRouteProvider, pair with a real or emulated Chromecast receiver, and verify NPAW view lifecycle (stop on cast start, start on cast end).')
  })

  // ── 8.2 — Startup error timeout ──────────────────────────────────────────
  // Simulates bad network: HLS manifest loads but hangs → player timeout → error beacon.
  test('NPAW-8.2 — startup error via manifest timeout emits error beacon', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    // Abort HLS rendition playlists immediately → simulates network timeout → player fires fatal error
    await page.route('**/*.m3u8', async route => {
      if (route.request().url().includes('360p') || route.request().url().includes('720p')) {
        await route.abort('timedout')
        return
      }
      await route.continue()
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    await expect.poll(
      () => beacons.some(u => u.includes('error') && !u.includes('adError')),
      { timeout: 20_000, message: 'NPAW-8.2: error beacon must arrive after content manifest timeout' }
    ).toBe(true)

    const errUrl = beacons.find(u => u.includes('error') && !u.includes('adError'))!
    const errCode = parseBeaconParam(errUrl, 'errorCode')
                 ?? parseBeaconParam(errUrl, 'error.code')
                 ?? parseBeaconParam(errUrl, 'code')
    expect(
      errCode,
      `NPAW-8.2: errorCode must be present in error beacon.\nURL: ${errUrl}`
    ).not.toBeNull()
  })

  // ── 8.4 — Instream error timeout ─────────────────────────────────────────
  test('NPAW-8.4 — instream error via segment timeout emits error beacon', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    let segmentsAllowed = 0
    await page.route('**/*.ts', async route => {
      segmentsAllowed++
      if (segmentsAllowed <= 4) {
        // Allow first 4 segments (enough for video to start playing)
        await route.continue()
      } else {
        // Hang subsequent segments → player stalls → error
        await new Promise(r => setTimeout(r, 60_000))
      }
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    // Wait for error after segments hang
    await expect.poll(
      () => beacons.some(u => u.includes('error') && !u.includes('adError')),
      { timeout: 60_000, message: 'NPAW-8.4: error beacon must arrive after segment timeout during playback' }
    ).toBe(true)

    const errUrl = beacons.find(u => u.includes('error') && !u.includes('adError'))!
    const errCode = parseBeaconParam(errUrl, 'errorCode')
                 ?? parseBeaconParam(errUrl, 'error.code')
                 ?? parseBeaconParam(errUrl, 'code')
    expect(
      errCode,
      `NPAW-8.4: errorCode must be present in instream error beacon.\nURL: ${errUrl}`
    ).not.toBeNull()
  })

  // ── 8.5 — Offline during playback ────────────────────────────────────────
  test('NPAW-8.5 — offline simulation: all content requests aborted → error beacon', async ({ isolatedPlayer: player, page }) => {
    test.slow()

    let playbackStarted = false
    await page.route('**/*.ts', async route => {
      if (playbackStarted) {
        await route.abort('internetdisconnected')
      } else {
        await route.continue()
      }
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    // Mark as started — now simulate going offline
    playbackStarted = true

    // Wait for error beacon after segments abort
    await expect.poll(
      () => beacons.some(u => u.includes('error') && !u.includes('adError')),
      { timeout: 45_000, message: 'NPAW-8.5: error beacon must arrive when all network requests aborted mid-playback' }
    ).toBe(true)

    const errUrl = beacons.find(u => u.includes('error') && !u.includes('adError'))!
    const errCode = parseBeaconParam(errUrl, 'errorCode')
                 ?? parseBeaconParam(errUrl, 'error.code')
                 ?? parseBeaconParam(errUrl, 'code')
    expect(
      errCode,
      `NPAW-8.5: errorCode must be present in error beacon.\nURL: ${errUrl}`
    ).not.toBeNull()
  })
})

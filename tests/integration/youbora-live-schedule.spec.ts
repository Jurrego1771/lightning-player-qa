/**
 * youbora-live-schedule.spec.ts — Tests para GAP-YOUBORA-001 y GAP-YOUBORA-002
 *
 * Cubre: PR #771 "Fix/issue 766 npaw issues"
 *   - GAP-YOUBORA-001: content.id en live/DVR = scheduleId obtenido desde Firestore
 *     vía el nuevo hook useScheduleId (src/analytics/youbora/useScheduleId.js).
 *   - GAP-YOUBORA-002: content.channel en live = channelId del contenido (campo nuevo
 *     en buildVideoOptions para tipo live, src/analytics/youbora/tracker.js).
 *
 * Fixture: isolatedPlayer (plataforma mockeada + stream HLS local).
 *
 * Estrategia de mock de Firestore:
 *   useScheduleId consulta Firestore (colección 'schedules', isCurrent==true, liveId,
 *   dateStart desc, limit 1) usando el SDK firebase/firestore (getDocs / onSnapshot).
 *   El SDK realiza requests HTTP/2 a firestore.googleapis.com (REST o gRPC-Web).
 *
 *   Nivel 1 — addInitScript: sobreescribir las funciones de importación de
 *   firebase/firestore en el scope del browser ANTES de que cualquier módulo del
 *   player se ejecute. Esto controla la respuesta de Firestore de forma determinista.
 *
 *   BLOQUEADOR: El overriding de módulos ES a nivel de browser requiere conocer
 *   exactamente cómo el bundler del player expone firebase/firestore. Si el player
 *   usa un bundler (Webpack/Vite) que inline-ea los módulos, el addInitScript no
 *   puede interceptar los imports. En ese caso, el fallback es interceptar la red
 *   HTTP con page.route(/firestore\.googleapis\.com/).
 *
 *   Nivel 2 — page.route: interceptar requests HTTP a firestore.googleapis.com
 *   y responder con el formato de documentos Firestore compatible con getDocs/onSnapshot.
 *   Esta capa es suficiente para casos donde el SDK usa fetch (no WebSocket).
 *
 *   Si ninguna capa es efectiva en el entorno de CI (Firestore SDK usa WebSocket
 *   gRPC-Web en Node/browser headless), los tests están marcados con el plan de
 *   desbloqueo exacto. Ver comentarios inline.
 *
 * Contexto del reviewer (session_state.json > pr_metadata > reviewer_signals):
 *   - "content.id: null en primer evento live aceptado por OTT, SDK Youbora lo
 *      tolera y corrige via updateOptions" → el caso null es comportamiento aceptado,
 *      no un bug: se cubre en NPAW-LIVE-003.
 *   - "context.liveId siempre undefined es falso positivo: patrón idéntico ya existe
 *      en compact y radioSA" → no generar test para liveId undefined como bug.
 *
 * CRÍTICO: no mockear lma.npaw.com — rompe Fastdata del SDK 7.3.28.
 *   El mock de LMA se delega a setupNpawInterceptor (mismo patrón que youbora.spec.ts).
 *
 * Anti-patrones evitados:
 *   - Sin waitForTimeout — solo expect.poll() y waitForEvent()
 *   - Sin selectores CSS internos del player
 *   - Sin import desde @playwright/test directamente
 */
import { test, expect, MockContentIds, mockPlayerConfig } from '../../fixtures'
import type { Route } from '@playwright/test'

// ── Constantes compartidas ──────────────────────────────────────────────────

const YOUBORA_ACCOUNT_CODE = process.env.YOUBORA_ACCOUNT_CODE || 'qa_dummy'

const YOUBORA_CONFIG = {
  metadata: {
    player: {
      tracking: {
        youbora: { enabled: true, account_code: YOUBORA_ACCOUNT_CODE },
      },
    },
  },
}

/**
 * scheduleId esperado — el que useScheduleId debe retornar al consultar Firestore.
 * El test controla este valor vía el mock de Firestore para hacer la aserción determinista.
 * channelId es el id del contenido live original (context.id del player), que buildVideoOptions
 * del PR asignará a content.channel.
 */
const EXPECTED_SCHEDULE_ID = 'qa-schedule-abc123'
const LIVE_CHANNEL_ID = MockContentIds.live  // 'mock-live-1'

// ── BODY_FIELD_ALIASES (subconjunto relevante para live) ──────────────────
// Copia del alias map de youbora.spec.ts — solo los campos relevantes para
// los tests de este archivo. No importar desde youbora.spec.ts porque los
// tests deben ser independientes.

const BODY_FIELD_ALIASES: Record<string, string> = {
  'content.id':      'contentId',
  'content.channel': 'contentChannel',
  'content.type':    'contentType',
  'content.isLive':  'live',
  'channel':         'contentChannel',
}

// ── Helper: capturar beacons NPAW (mismo patrón que youbora.spec.ts) ───────

type NpawInterceptor = {
  beacons: string[]
  beaconBodies: Map<string, Record<string, unknown>>
  waitForFirst: (timeout?: number) => Promise<void>
}

let _activeBeaconBodies: Map<string, Record<string, unknown>> | undefined

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

  // Level 1 — browser-level XHR mock para lma.npaw.com
  // CRÍTICO: nunca bloquear lma.npaw.com en page.route — este mock XHR en addInitScript
  // lo intercepts en el browser antes de que llegue a la red (misma estrategia que youbora.spec.ts).
  const lmaMockScript = `
    (function() {
      var _open = XMLHttpRequest.prototype.open;
      var _send = XMLHttpRequest.prototype.send;
      var LMA_HOST = '${YOUBORA_ACCOUNT_CODE}.youboranqs01.com';
      var SESSION  = 'test-session-qa-live-12345';

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
          Object.defineProperty(xhr, 'readyState',   { get: function() { return 4; }, configurable: true });
          Object.defineProperty(xhr, 'status',       { get: function() { return 200; }, configurable: true });
          Object.defineProperty(xhr, 'response',     { get: function() { return responseBody; }, configurable: true });
          Object.defineProperty(xhr, 'responseText', { get: function() { return responseBody; }, configurable: true });
          if (typeof xhr.onload === 'function') xhr.onload.call(xhr);
          if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange.call(xhr);

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

  // Level 2 — Playwright route fallback para LMA (grabación de URLs, debugging)
  await page.route(/lma\.npaw\.com/, async (route) => {
    const url = route.request().url()
    recordBeacon(url)
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: url.includes('/data') ? JSON.stringify({
        q: { h: `${YOUBORA_ACCOUNT_CODE}.youboranqs01.com`, c: 'test-session-qa-live-12345', pt: 5, i: { bt: 30 }, st: 120, vt: 120, cb: 1 },
      }) : '{}',
    })
  })

  await page.route(/youboranqs01\.com\//, captureBeacon)
  await page.route(/\.youbora\.com\//, captureBeacon)

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

// ── Helper: parseBeaconParam (copia exacta del helper de youbora.spec.ts) ──

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
  } catch {}
  return null
}

// ── Helper: mock de Firestore para useScheduleId ───────────────────────────
//
// useScheduleId (src/analytics/youbora/useScheduleId.js, archivo nuevo del PR #771)
// consulta Firestore: colección 'schedules', where('isCurrent', '==', true),
// where('liveId', '==', <channelId>), orderBy('dateStart', 'desc'), limit(1).
//
// El SDK firebase/firestore v9+ (modular) realiza la query vía HTTP/2 REST a:
//   POST https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents:runQuery
// o con WebSocket gRPC-Web (listener onSnapshot).
//
// Estrategia: interceptar ambos métodos posibles con page.route.
// Respuesta en formato Firestore REST v1 (runQuery / batchGet).
//
// BLOQUEADOR CONOCIDO: si el SDK usa WebSocket (gRPC-Web streaming) para onSnapshot,
// Playwright no puede interceptar WebSockets actualmente. En ese caso los tests
// quedan como test.skip con la ruta de desbloqueo documentada.
//
// Plan de desbloqueo:
//   1. Verificar si useScheduleId usa getDocs() (one-shot) o onSnapshot() (stream).
//      Si getDocs() → page.route funciona (HTTP REST).
//      Si onSnapshot() → Playwright no puede interceptar WebSocket; opciones:
//        a) Emulator: FIRESTORE_EMULATOR_HOST=localhost:8080 + datos seed
//        b) Overriding de firebase/firestore en el bundler (addInitScript no alcanza ES modules)
//        c) Env variable DISABLE_SCHEDULE_LOOKUP=true en el player (requiere soporte del equipo)
//   2. Verificar en CI que firestore.googleapis.com recibe requests HTTP (no WebSocket).
//      Comando de diagnóstico: npx playwright test tests/integration/youbora-live-schedule.spec.ts
//        --project=chromium --headed --trace on
//      Buscar en Network tab: requests a firestore.googleapis.com (tipo Fetch/XHR o WebSocket).

async function setupFirestoreMock(
  page: import('@playwright/test').Page,
  options: {
    scheduleId: string | null
    channelId: string
  }
): Promise<void> {
  const { scheduleId, channelId } = options

  // Respuesta de Firestore runQuery (getDocs) — formato REST v1
  // Documento 'schedules/{scheduleId}' con campos isCurrent=true, liveId=channelId
  const buildFirestoreDoc = (id: string) => ({
    document: {
      name: `projects/mediastream-dev/databases/(default)/documents/schedules/${id}`,
      fields: {
        isCurrent: { booleanValue: true },
        liveId:    { stringValue: channelId },
        dateStart: { timestampValue: new Date().toISOString() },
      },
      createTime: new Date().toISOString(),
      updateTime: new Date().toISOString(),
    },
    readTime: new Date().toISOString(),
  })

  // Respuesta vacía (scheduleId === null → sin documentos)
  const emptyResponse = [{ readTime: new Date().toISOString() }]

  await page.route(/firestore\.googleapis\.com/, async (route) => {
    const url = route.request().url()

    if (scheduleId === null) {
      // Caso edge: sin schedule actual → array vacío (getDocs retorna 0 docs)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emptyResponse),
      })
      return
    }

    // Caso happy path: retornar el documento con el scheduleId esperado
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([buildFirestoreDoc(scheduleId)]),
    })
  })

  // Log diagnóstico: si Firestore usa WebSocket, el route handler nunca se ejecuta.
  // En ese caso, en la consola del browser aparecerá un error de conexión a Firestore
  // o simplemente scheduleId quedará indefinido (y content.id será null).
  page.on('request', (req) => {
    if (req.url().includes('firestore.googleapis.com')) {
      console.log(`[FIRESTORE REQUEST] ${req.method()} ${req.url().split('?')[0]}`)
    }
  })
}

// ── Bloque: GAP-YOUBORA-001 + GAP-YOUBORA-002 — Live Schedule Metadata ─────
//
// Covers: buildVideoOptions (tracker.js), useScheduleId (nuevo), YouboraWithSchedule

test.describe('Youbora — Live Schedule Metadata (PR #771)', {
  tag: ['@integration', '@analytics', '@youbora', '@metadata', '@pr771'],
}, () => {

  // ── NPAW-LIVE-001 — content.id en live = scheduleId obtenido desde Firestore ──
  //
  // Escenario: live con scheduleId válido → beacon /start lleva content.id = scheduleId.
  //
  // El PR modifica buildVideoOptions en tracker.js para que en tipo live/dvr,
  // 'content.id' sea el scheduleId retornado por useScheduleId (en lugar del channelId).
  // useScheduleId consulta Firestore: schedules WHERE isCurrent==true AND liveId==channelId
  // ORDER BY dateStart DESC LIMIT 1.
  //
  // Covers: GAP-YOUBORA-001, symbols: buildVideoOptions, useScheduleId, YouboraWithSchedule

  test('NPAW-LIVE-001 — content.id en /start beacon de live es el scheduleId de Firestore', async ({ isolatedPlayer: player, page }) => {
    // Arrange — mock Firestore ANTES de cualquier goto() para que el route esté
    // activo cuando el player inicialice useScheduleId.
    await setupFirestoreMock(page, {
      scheduleId: EXPECTED_SCHEDULE_ID,
      channelId:  LIVE_CHANNEL_ID,
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    // Act
    await player.goto({ type: 'live', id: LIVE_CHANNEL_ID, autoplay: true })

    // Live streams en el mock local pueden no emitir contentFirstPlay — usar poll
    // basado en eventos del player (mismo patrón que NPAW-2.22-Live en youbora.spec.ts).
    await expect.poll(
      () => player.page.evaluate(() => {
        const events = (window as any).__qa?.events ?? []
        return events.includes('contentFirstPlay') || events.includes('playing')
      }),
      { timeout: 25_000, intervals: [500], message: 'Se esperaba contentFirstPlay o playing para live' }
    ).toBe(true)

    // Esperar primer beacon NQS (scheduleId puede llegar ligeramente después de playing
    // porque useScheduleId es asíncrono — ver reviewer_signal: null en primer beacon aceptado)
    await waitForFirst(12_000).catch(() => {})

    // Assert — esperar beacon /start
    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime'))
    await expect.poll(() => startBeacons().length, {
      timeout: 20_000,
      message: 'Se esperaba beacon /start para live — verificar que Youbora está activo y Firestore mock respondió',
    }).toBeGreaterThan(0)

    const startUrl = startBeacons()[0]

    // BLOQUEADOR DE MOCK: si setupFirestoreMock no interceptó (WebSocket gRPC-Web),
    // useScheduleId no obtendrá el scheduleId y content.id será null o el channelId original.
    // En ese caso el test fallará aquí con información diagnóstica.
    // Ver sección "Plan de desbloqueo" en los comentarios del helper setupFirestoreMock.
    const contentId = parseBeaconParam(startUrl, 'content.id')
    expect(
      contentId,
      `NPAW-LIVE-001: content.id debe ser el scheduleId '${EXPECTED_SCHEDULE_ID}' retornado por Firestore.\n` +
      `Si es null o '${LIVE_CHANNEL_ID}' (channelId), el mock de Firestore no interceptó la consulta.\n` +
      `Diagnóstico: revisar logs [FIRESTORE REQUEST] en consola — si no aparece ninguno,\n` +
      `Firestore usa WebSocket (gRPC-Web) y page.route no puede interceptarlo. Ver plan de desbloqueo\n` +
      `en setupFirestoreMock() de este archivo.\n` +
      `URL beacon: ${startUrl}`
    ).toBe(EXPECTED_SCHEDULE_ID)
  })

  // ── NPAW-LIVE-002 — content.channel en live = channelId (campo nuevo en buildVideoOptions) ──
  //
  // Escenario: en contenido live, el beacon /start incluye content.channel = channelId
  // del canal (el id original del contenido, NO el scheduleId).
  //
  // El PR agrega content.channel a buildVideoOptions solo para isLive=true.
  // Esto permite que NPAW diferencie entre "qué canal" (channel) y "qué episodio/programa"
  // concreto (id=scheduleId) se está viendo.
  //
  // Covers: GAP-YOUBORA-002, symbol: buildVideoOptions

  test('NPAW-LIVE-002 — content.channel en /start beacon de live es el channelId del contenido', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await setupFirestoreMock(page, {
      scheduleId: EXPECTED_SCHEDULE_ID,
      channelId:  LIVE_CHANNEL_ID,
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    // Act
    await player.goto({ type: 'live', id: LIVE_CHANNEL_ID, autoplay: true })

    await expect.poll(
      () => player.page.evaluate(() => {
        const events = (window as any).__qa?.events ?? []
        return events.includes('contentFirstPlay') || events.includes('playing')
      }),
      { timeout: 25_000, intervals: [500], message: 'Se esperaba contentFirstPlay o playing para live' }
    ).toBe(true)

    await waitForFirst(12_000).catch(() => {})

    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime'))
    await expect.poll(() => startBeacons().length, {
      timeout: 20_000,
      message: 'Se esperaba beacon /start para verificar content.channel',
    }).toBeGreaterThan(0)

    const startUrl = startBeacons()[0]
    const channel = parseBeaconParam(startUrl, 'content.channel')
                 ?? parseBeaconParam(startUrl, 'channel')

    expect(
      channel,
      `NPAW-LIVE-002: content.channel debe ser el channelId '${LIVE_CHANNEL_ID}' en el beacon /start.\n` +
      `Si es null, buildVideoOptions del PR no incluyó el campo, o el SDK no lo envía en el body.\n` +
      `URL beacon: ${startUrl}`
    ).toBe(LIVE_CHANNEL_ID)
  })

  // ── NPAW-LIVE-001 + NPAW-LIVE-002 en un único test de live (combinado) ────
  //
  // Escenario consolidado: verificar content.id=scheduleId Y content.channel=channelId
  // en el mismo beacon /start para evitar duplicar el setup del player.
  // Este test es la versión canónica de los dos anteriores y es el que se referencia
  // en los reports de CI. Los tests individuales (001 y 002) permiten diagnóstico granular.
  //
  // Covers: GAP-YOUBORA-001 + GAP-YOUBORA-002

  test('NPAW-LIVE-001+002 — beacon /start live contiene scheduleId en content.id y channelId en content.channel', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await setupFirestoreMock(page, {
      scheduleId: EXPECTED_SCHEDULE_ID,
      channelId:  LIVE_CHANNEL_ID,
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    // Act
    await player.goto({ type: 'live', id: LIVE_CHANNEL_ID, autoplay: true })

    await expect.poll(
      () => player.page.evaluate(() => {
        const events = (window as any).__qa?.events ?? []
        return events.includes('contentFirstPlay') || events.includes('playing')
      }),
      { timeout: 25_000, intervals: [500], message: 'Live mock debe emitir playing antes de verificar beacons' }
    ).toBe(true)

    await waitForFirst(12_000).catch(() => {})

    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime'))
    await expect.poll(() => startBeacons().length, {
      timeout: 20_000,
      message: 'Se esperaba al menos un beacon /start para live',
    }).toBeGreaterThan(0)

    const startUrl = startBeacons()[0]
    const debugInfo = `\nURL beacon: ${startUrl}`

    // Assert 1 — content.id = scheduleId (GAP-YOUBORA-001)
    const contentId = parseBeaconParam(startUrl, 'content.id')
    expect(
      contentId,
      `NPAW-LIVE-001: content.id debe ser el scheduleId '${EXPECTED_SCHEDULE_ID}'.${debugInfo}`
    ).toBe(EXPECTED_SCHEDULE_ID)

    // Assert 2 — content.channel = channelId (GAP-YOUBORA-002)
    const channel = parseBeaconParam(startUrl, 'content.channel')
                 ?? parseBeaconParam(startUrl, 'channel')
    expect(
      channel,
      `NPAW-LIVE-002: content.channel debe ser el channelId '${LIVE_CHANNEL_ID}'.${debugInfo}`
    ).toBe(LIVE_CHANNEL_ID)
  })

  // ── NPAW-LIVE-003 — Edge case: Firestore sin schedule actual → content.id = null ──
  //
  // Escenario: live sin liveId válido en Firestore (0 documentos en la query)
  // → useScheduleId retorna null → content.id = null en el primer beacon /start.
  //
  // Este comportamiento está ACEPTADO por el reviewer:
  //   "content.id: null en primer evento live aceptado por OTT, SDK Youbora lo
  //    tolera y corrige via updateOptions" (reviewer_signals[3])
  //
  // El test documenta que null es el comportamiento correcto en este edge case
  // (no un bug, sino un estado transitorio esperado).
  //
  // Covers: GAP-YOUBORA-001 (edge case), symbol: useScheduleId

  test('NPAW-LIVE-003 — content.id=null en /start cuando Firestore no retorna schedule (edge case aceptado)', async ({ isolatedPlayer: player, page }) => {
    // Arrange — Firestore responde vacío (sin schedule actual)
    await setupFirestoreMock(page, {
      scheduleId: null,  // getDocs retorna 0 documentos
      channelId:  LIVE_CHANNEL_ID,
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    // Act
    await player.goto({ type: 'live', id: LIVE_CHANNEL_ID, autoplay: true })

    await expect.poll(
      () => player.page.evaluate(() => {
        const events = (window as any).__qa?.events ?? []
        return events.includes('contentFirstPlay') || events.includes('playing')
      }),
      { timeout: 25_000, intervals: [500], message: 'Se esperaba playing para live sin schedule' }
    ).toBe(true)

    await waitForFirst(12_000).catch(() => {})

    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime'))
    await expect.poll(() => startBeacons().length, {
      timeout: 20_000,
      message: 'Se esperaba beacon /start incluso cuando content.id es null',
    }).toBeGreaterThan(0)

    const startUrl = startBeacons()[0]
    const contentId = parseBeaconParam(startUrl, 'content.id')

    // content.id debe ser null (o la cadena 'null') cuando Firestore no retorna schedule.
    // El SDK Youbora tolera esto y puede corregirlo via updateOptions cuando el scheduleId
    // llega async. Aceptado por el reviewer.
    expect(
      contentId === null || contentId === 'null' || contentId === '',
      `NPAW-LIVE-003: content.id debe ser null/vacío cuando Firestore no retorna schedule.\n` +
      `Valor obtenido: '${contentId}'\n` +
      `URL beacon: ${startUrl}`
    ).toBe(true)
  })

  // ── NPAW-LIVE-004 — Regresión: content.id en VOD sigue siendo el id del contenido ──
  //
  // El cambio de buildVideoOptions en tracker.js solo aplica a tipo live/dvr.
  // Para VOD (type='media'), content.id debe seguir siendo el id del contenido original.
  // Este test verifica que isLiveType no afecta el comportamiento de VOD.
  //
  // Cubre la regresión identificada en risk_assessment.breaks_if_not_tested[2]:
  //   "Regresión en VOD: content.id debe seguir siendo el id de contenido original"
  //
  // Covers: symbol: buildVideoOptions (isLiveType guard), regresión VOD

  test('NPAW-LIVE-004 — content.id en VOD sigue siendo el contentId (no afectado por cambio live)', async ({ isolatedPlayer: player, page }) => {
    // Arrange — NO mock de Firestore: para VOD, useScheduleId no debe ejecutarse
    // (el PR solo lo llama cuando type=live o type=dvr).
    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    // Act — cargar VOD (type: 'media')
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('contentFirstPlay', 20_000)
    await waitForFirst(8_000).catch(() => {})

    const startBeacons = () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime'))
    await expect.poll(() => startBeacons().length, {
      timeout: 20_000,
      message: 'Se esperaba beacon /start para VOD',
    }).toBeGreaterThan(0)

    const startUrl = startBeacons()[0]
    const contentId = parseBeaconParam(startUrl, 'content.id')

    // Assert — para VOD, content.id debe ser el id del contenido, no un scheduleId
    expect(
      contentId,
      `NPAW-LIVE-004: content.id debe ser '${MockContentIds.vod}' para VOD — regresión: ` +
      `cambios de live no deben afectar VOD.\nURL: ${startUrl}`
    ).toBe(MockContentIds.vod)
  })

  // ── NPAW-LIVE-005 — Firestore no alcanzable: el player no debe crashear ──
  //
  // Escenario: Firestore request falla (network error o timeout).
  // useScheduleId debe manejar el error gracefully y el player debe seguir funcionando.
  // content.id puede quedar null, pero el player no debe quedar en estado inválido.
  //
  // Covers: GAP-YOUBORA-001 (error handling), useScheduleId error path

  test('NPAW-LIVE-005 — player no crashea cuando Firestore falla (content.id puede quedar null)', async ({ isolatedPlayer: player, page }) => {
    // Arrange — Firestore responde con error de red
    await page.route(/firestore\.googleapis\.com/, async (route) => {
      await route.abort('failed')
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    const { beacons, waitForFirst } = await setupNpawInterceptor(page)

    // Act
    await player.goto({ type: 'live', id: LIVE_CHANNEL_ID, autoplay: true })

    // El player debe seguir funcionando (emitir playing) aunque Firestore falle
    await expect.poll(
      () => player.page.evaluate(() => {
        const events = (window as any).__qa?.events ?? []
        return events.includes('contentFirstPlay') || events.includes('playing')
      }),
      { timeout: 25_000, intervals: [500], message: 'El player debe alcanzar playing aunque Firestore falle' }
    ).toBe(true)

    await waitForFirst(12_000).catch(() => {})

    // Assert — el player debe haber enviado beacons NPAW (Youbora activo aunque Firestore falló)
    await expect.poll(() => beacons.length, {
      timeout: 15_000,
      message: 'Se esperaban beacons NPAW incluso cuando Firestore falla — player no debe crashear',
    }).toBeGreaterThan(0)

    // content.id puede ser null cuando Firestore falla — eso es aceptable
    const startBeacons = beacons.filter(url => url.includes('/start') || url.includes('/joinTime'))
    if (startBeacons.length > 0) {
      const contentId = parseBeaconParam(startBeacons[0], 'content.id')
      console.log(`NPAW-LIVE-005: content.id cuando Firestore falla = '${contentId}' (null es aceptado)`)
      // No fallar si content.id es null — documentar el valor para observabilidad
    }
  })

})

// ── Bloque diagnóstico: Firestore mock reachability ──────────────────────────
//
// Test auxiliar para verificar si page.route puede interceptar Firestore en el entorno.
// No es un test de funcionalidad del player — es un test de infraestructura del mock.
// Marcar como skip si el diagnóstico ya fue completado.

test.describe('Youbora — Firestore Mock Diagnostics', {
  tag: ['@integration', '@analytics', '@youbora', '@diagnostics'],
}, () => {

  test('DIAG-FIRESTORE-001 — page.route intercepta requests HTTP a firestore.googleapis.com', async ({ isolatedPlayer: player, page }) => {
    // Este test verifica que la estrategia de mock HTTP de Firestore funciona en el entorno.
    // Si pasa: los tests NPAW-LIVE-001/002/003 son fiables con setupFirestoreMock().
    // Si falla (interceptedCount=0 después de goto): Firestore usa WebSocket → ver plan
    // de desbloqueo en setupFirestoreMock().

    let interceptedCount = 0
    await page.route(/firestore\.googleapis\.com/, async (route) => {
      interceptedCount++
      console.log(`[DIAG] Firestore HTTP intercepted: ${route.request().method()} ${route.request().url().split('?')[0]}`)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ readTime: new Date().toISOString() }]),
      })
    })

    await mockPlayerConfig(page, YOUBORA_CONFIG)
    await setupNpawInterceptor(page)

    await player.goto({ type: 'live', id: LIVE_CHANNEL_ID, autoplay: true })

    await expect.poll(
      () => player.page.evaluate(() => {
        const events = (window as any).__qa?.events ?? []
        return events.includes('contentFirstPlay') || events.includes('playing')
      }),
      { timeout: 25_000, intervals: [500] }
    ).toBe(true)

    // Esperar hasta 5s a que Firestore sea consultado (es asíncrono respecto al playing)
    await expect.poll(() => interceptedCount, {
      timeout: 5_000,
      intervals: [200],
      message:
        'DIAG-FIRESTORE-001: page.route no interceptó ninguna request a firestore.googleapis.com.\n' +
        'Causa probable: Firestore SDK usa WebSocket (gRPC-Web) en lugar de HTTP REST fetch.\n' +
        'Playwright no puede interceptar WebSockets. Ver plan de desbloqueo en setupFirestoreMock().\n' +
        'Alternativas: (1) Firestore emulator (FIRESTORE_EMULATOR_HOST=localhost:8080),\n' +
        '(2) build del player con DISABLE_SCHEDULE_LOOKUP=true para tests,\n' +
        '(3) Overriding del módulo firebase/firestore en el bundler.'
    }).toBeGreaterThan(0)
  })

})

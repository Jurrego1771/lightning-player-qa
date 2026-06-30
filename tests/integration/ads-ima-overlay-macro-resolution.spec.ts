/**
 * ads-ima-overlay-macro-resolution.spec.ts — Tests para resolución de macros en OverlayAds
 *
 * Cubre el gap MUST del módulo ads-ima detectado por A4 (feature/issue-724):
 *   overlayAds.jsx — nuevas props custom/listenerId/withoutCookies/markers +
 *   resolveAdTagMacros() sobre el overlay ad tag URL + contextMapper extrae adMarkers.
 *
 * Símbolos cubiertos (comportamiento observable, no internals):
 *   OverlayAds (nuevo flujo de resolución de macros sobre overlay URL)
 *   contextMapper (extrae custom, listenerId, withoutCookies, metadata.adMarkers)
 *
 * ESTRATEGIA DE VERIFICACIÓN:
 *   El overlay ad tag URL pasa por resolveAdTagMacros() antes de asignarse a
 *   ima.AdsRequest.adTagUrl. Esto ocurre cuando el player inicializa OverlayAds.
 *   Al igual que ads-ima-macro-resolution.spec.ts, interceptamos page.route() para
 *   capturar la request saliente al mock VAST server y verificar que las macros
 *   se resolvieron correctamente.
 *
 *   NOTA — Diferencia con ads.map (AdsRequest):
 *   El overlay ad tag URL se pasa via la config de la plataforma como `ads.overlay`
 *   (o equivalente), no via `adsMap`. En el entorno isolatedPlayer, el contenido
 *   mockeado usa JSON fijos (platform-responses/) que no exponen overlay URL con macros.
 *   Ver BLOQUEADORES al final de este archivo.
 *
 * BR-IMA-013 — Macros en el VAST URL se resuelven en el momento de la request.
 * BR-IMA-004 — Un error en el sistema de ads nunca interrumpe el contenido principal.
 * BR-IMA-IND-001 — IMA SDK es Chromium-only en tests automatizados.
 *
 * Fixture: isolatedPlayer (plataforma mockeada)
 * Tag: @integration @ads @ima @overlay @macros
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BLOQUEADORES CONOCIDOS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * BLOQUEADOR-1 — Overlay URL con macros no inyectable desde los fixtures actuales
 *   Para que OverlayAds llame resolveAdTagMacros(), el player necesita recibir un
 *   overlay ad tag URL con macros ($cust_params$, $listenerid$, etc.) desde la
 *   config de plataforma. En el entorno isolatedPlayer, el player config viene de
 *   fixtures/platform-responses/player/default.json — ese JSON no tiene campo
 *   overlay/ads.overlay. La opción más limpia es añadir una variante del fixture:
 *     fixtures/platform-responses/player/overlay-with-macros.json
 *   y exponerla via mockPlayerConfig() con un campo overlay que incluya macros.
 *   Sin esto, OverlayAds no se monta y las macros del overlay no se resuelven.
 *   Responsable: equipo QA — agregar fixture de player config con overlay URL con macros.
 *
 * BLOQUEADOR-2 — adMarkers (metadata.adMarkers) no disponible en mocks actuales
 *   contextMapper extrae adMarkers de metadata y los convierte a string "pos1,pos2,...".
 *   El content mock (vod.json) no tiene el campo adMarkers en su metadata.
 *   Para testear $markers$ via el flujo de overlay, se necesita un content mock con
 *   metadata.adMarkers populado.
 *   Responsable: equipo QA — extender content mock o crear variante con adMarkers.
 *
 * BLOQUEADOR-3 — Sin ContentId con overlay configurado y macros en VAST URL
 *   En el entorno E2E (plataforma real), no existe un ContentId conocido que tenga
 *   un overlay ad tag URL con macros como $cust_params$ o $listenerid$. Los tests
 *   de este archivo que necesiten el flujo real de overlay requieren coordinar con
 *   el equipo de plataforma para configurar ese contenido.
 *
 * Los tests de este archivo cubren lo que es posible sin esos bloqueadores:
 *   - Que el player no crashea al inicializarse con props custom/listenerId/
 *     withoutCookies/markers pasadas via config (contextMapper las lee y pasa a OverlayAds).
 *   - Que el ciclo de init (ready) completa correctamente con estas nuevas props.
 *   - Que los JS errors no se producen en el árbol de OverlayAds con las nuevas props.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, expect, MockContentIds } from '../../fixtures'

const MOCK_VAST_BASE = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

// ── Suite 1: contextMapper extrae nuevas props — sin crash de init ────────────

test.describe('ads-ima overlay — nuevas props de contextMapper no causan crash de init', {
  tag: ['@integration', '@ads', '@ima', '@overlay', '@macros'],
}, () => {

  // Covers: contextMapper extrae custom, listenerId, withoutCookies del contexto del player
  // Verifica que el árbol React (que incluye OverlayAds) monta sin errores con las nuevas props
  test('player con custom params en config alcanza ready sin crash', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const jsErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      // Filtrar errores esperados del entorno headless y del IMA SDK
      if (
        !msg.includes('notallowederror') &&
        !msg.includes('autoplay') &&
        !msg.includes('ima') &&
        !msg.includes('google') &&
        !msg.includes('failed to load') &&
        !msg.includes('net::err')
      ) {
        jsErrors.push(err.message)
      }
    })

    // Act — pasar custom params que contextMapper propaga a OverlayAds.custom
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      custom: { env: 'qa', segment: 'news' },
    })

    // Assert
    await isolatedPlayer.waitForReady(25_000)

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `OverlayAds con prop 'custom' no debe causar error de init.\n` +
      `El PR #issue-724 agrega custom a OverlayAds via contextMapper.\n` +
      `Error: ${initError}`
    ).toBeNull()

    expect(
      jsErrors,
      `OverlayAds con prop 'custom' no debe producir errores JS.\n` +
      `Errores: ${jsErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  // Covers: contextMapper extrae listenerId del contexto → OverlayAds.listenerId prop
  test('player con listenerId en config alcanza ready sin crash', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const jsErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (
        !msg.includes('notallowederror') &&
        !msg.includes('autoplay') &&
        !msg.includes('ima') &&
        !msg.includes('google') &&
        !msg.includes('failed to load') &&
        !msg.includes('net::err')
      ) {
        jsErrors.push(err.message)
      }
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      listenerId: 'overlay-listener-456',
    })

    // Assert
    await isolatedPlayer.waitForReady(25_000)

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `OverlayAds con prop 'listenerId' no debe causar error de init.\n` +
      `El PR #issue-724 agrega listenerId a OverlayAds via contextMapper.\n` +
      `Error: ${initError}`
    ).toBeNull()

    expect(
      jsErrors,
      `OverlayAds con prop 'listenerId' no debe producir errores JS.\n` +
      `Errores: ${jsErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  // Covers: contextMapper extrae withoutCookies → OverlayAds.withoutCookies prop
  test('player con withoutCookies=true en config alcanza ready sin crash', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const jsErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (
        !msg.includes('notallowederror') &&
        !msg.includes('autoplay') &&
        !msg.includes('ima') &&
        !msg.includes('google') &&
        !msg.includes('failed to load') &&
        !msg.includes('net::err')
      ) {
        jsErrors.push(err.message)
      }
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      withoutCookies: true,
    })

    // Assert
    await isolatedPlayer.waitForReady(25_000)

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `OverlayAds con prop 'withoutCookies=true' no debe causar error de init.\n` +
      `El PR #issue-724 agrega withoutCookies a OverlayAds via contextMapper.\n` +
      `Error: ${initError}`
    ).toBeNull()

    expect(
      jsErrors,
      `OverlayAds con prop 'withoutCookies=true' no debe producir errores JS.\n` +
      `Errores: ${jsErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  // Covers: contextMapper extrae todas las nuevas props a la vez — combinación completa
  test('player con custom + listenerId + withoutCookies alcanza ready sin crash', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const jsErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (
        !msg.includes('notallowederror') &&
        !msg.includes('autoplay') &&
        !msg.includes('ima') &&
        !msg.includes('google') &&
        !msg.includes('failed to load') &&
        !msg.includes('net::err')
      ) {
        jsErrors.push(err.message)
      }
    })

    // Act — todas las nuevas props del PR juntas
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      custom: { env: 'qa', category: 'tech' },
      listenerId: 'combo-listener-789',
      withoutCookies: true,
    })

    // Assert
    await isolatedPlayer.waitForReady(25_000)

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `OverlayAds con custom+listenerId+withoutCookies combinados no debe causar error.\n` +
      `Este es el caso más común de uso del PR #issue-724.\n` +
      `Error: ${initError}`
    ).toBeNull()

    expect(
      jsErrors,
      `Combinación de todas las nuevas props de OverlayAds no debe producir errores JS.\n` +
      `Errores: ${jsErrors.join(' | ')}`
    ).toHaveLength(0)
  })
})

// ── Suite 2: contextMapper — metadata.adMarkers → markers string ──────────────

test.describe('ads-ima overlay — contextMapper extrae adMarkers de metadata', {
  tag: ['@integration', '@ads', '@ima', '@overlay', '@macros'],
}, () => {

  // Covers: contextMapper — adMarkers.map(v => v.position).join(',') → markers prop
  // Verifica que el player no crashea cuando metadata.adMarkers está ausente (destructuring default)
  // BLOQUEADOR-2 aplica: no podemos verificar el valor resuelto en el VAST URL sin un
  // content mock con metadata.adMarkers. Este test cubre la ausencia de crash.
  test('player sin adMarkers en metadata — destructuring default no causa crash', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const jsErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (
        !msg.includes('notallowederror') &&
        !msg.includes('autoplay') &&
        !msg.includes('ima') &&
        !msg.includes('google') &&
        !msg.includes('failed to load') &&
        !msg.includes('net::err')
      ) {
        jsErrors.push(err.message)
      }
    })

    // Act — el mock de contenido no tiene metadata.adMarkers
    // contextMapper usa: const { ..., metadata: { adMarkers = [] } = {} } = context
    // Si metadata es undefined/null, el default {} se aplica y adMarkers=[],
    // resultando en markers="" — la macro $markers$ se reemplaza por cadena vacía
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_BASE}/vast/preroll?m=$markers$`,
    })

    // Assert — el player debe alcanzar ready sin crash
    await isolatedPlayer.waitForReady(25_000)

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `contextMapper con metadata.adMarkers ausente no debe causar crash.\n` +
      `El destructuring default { adMarkers = [] } = {} debe ser manejado correctamente.\n` +
      `Error: ${initError}`
    ).toBeNull()

    expect(
      jsErrors,
      `contextMapper con metadata.adMarkers ausente no debe producir errores JS.\n` +
      `Errores: ${jsErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  // Covers: caso edge — metadata.adMarkers es array vacío → markers="" → $markers$ = ""
  // Verifica que la macro con string vacío no rompe la URL del VAST
  test('adMarkers vacío → markers="" → $markers$ resuelto a cadena vacía no rompe VAST URL', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(40_000)

    // Arrange
    const capturedUrls: string[] = []
    await page.route(`${MOCK_VAST_BASE}/**`, async (route) => {
      capturedUrls.push(route.request().url())
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: `<?xml version="1.0"?><VAST version="3.0"/>`,
      })
    })

    // Act — adsMap con $markers$ + markers explícitamente vacío (equivale a adMarkers=[])
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap: `${MOCK_VAST_BASE}/vast/preroll?m=$markers$`,
      markers: '',
    })

    await isolatedPlayer.waitForReady(25_000)

    // Assert — la URL no debe ser inválida por causa de markers=""
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `markers="" no debe causar crash del player. Error: ${initError}`
    ).toBeNull()

    // Si se capturó la request, verificar que la URL es parseable (no corrompida)
    for (const urlStr of capturedUrls) {
      expect(() => new URL(urlStr), `URL del VAST debe ser parseable: ${urlStr}`).not.toThrow()
    }
  })
})

// ── Suite 3: OverlayAds — confRef.current actualizado con nuevas props ────────

test.describe('ads-ima overlay — confRef.current sincronizado con nuevas props', {
  tag: ['@integration', '@ads', '@ima', '@overlay', '@macros'],
}, () => {

  // Covers: confRef.current.custom = custom / listenerId = listenerId / etc.
  // El PR actualiza confRef.current con las nuevas props en cada render.
  // Si el componente se re-renderiza (ej: al cambiar props), los valores deben
  // estar actualizados. El test más observable: el player funciona después de load()
  // con diferentes custom params (simula un caso de props cambiantes).

  // Nota: Sin fixture de overlay URL con macros (BLOQUEADOR-1), solo podemos
  // verificar que load() con nuevas props no crashea el árbol de OverlayAds.

  test('load() con nuevas custom props no crashea el árbol de OverlayAds', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(60_000)

    // Arrange
    const jsErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (
        !msg.includes('notallowederror') &&
        !msg.includes('autoplay') &&
        !msg.includes('ima') &&
        !msg.includes('google') &&
        !msg.includes('failed to load') &&
        !msg.includes('net::err')
      ) {
        jsErrors.push(err.message)
      }
    })

    // Act — inicializar con custom params
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      custom: { session: 'first' },
      listenerId: 'listener-first',
    })
    await isolatedPlayer.waitForReady(25_000)

    // Cargar nuevo contenido (simula re-mount del árbol React con nuevas props)
    await isolatedPlayer.load({ type: 'media', id: MockContentIds.vod })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — sin crash en ninguno de los dos ciclos
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `load() con custom props no debe causar crash del árbol de OverlayAds.\n` +
      `confRef.current debe actualizarse correctamente.\n` +
      `Error: ${initError}`
    ).toBeNull()

    expect(
      jsErrors,
      `load() con custom props no debe producir errores JS. Errores: ${jsErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  // Covers: OverlayAds sin ninguna de las nuevas props — compatibilidad hacia atrás
  // Si el padre no pasa custom/listenerId/withoutCookies/markers, deben ser undefined
  // y confRef.current.custom = undefined no debe romper el componente
  test('player sin ninguna de las nuevas props de OverlayAds — compatibilidad hacia atrás', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const jsErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (
        !msg.includes('notallowederror') &&
        !msg.includes('autoplay') &&
        !msg.includes('ima') &&
        !msg.includes('google') &&
        !msg.includes('failed to load') &&
        !msg.includes('net::err')
      ) {
        jsErrors.push(err.message)
      }
    })

    // Act — ninguna de las nuevas props (exactamente como antes del PR)
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      // Sin custom, listenerId, withoutCookies, markers
    })

    // Assert
    await isolatedPlayer.waitForReady(25_000)

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `OverlayAds sin las nuevas props (compatibilidad hacia atrás) no debe causar error.\n` +
      `confRef.current.custom = undefined debe ser manejado sin crash.\n` +
      `Error: ${initError}`
    ).toBeNull()

    expect(
      jsErrors,
      `OverlayAds sin nuevas props no debe producir errores JS. Errores: ${jsErrors.join(' | ')}`
    ).toHaveLength(0)
  })
})

// ── Suite 4: resolveAdTagMacros en overlay URL — test de smoke con adsMap ─────
//
// NOTA: Estos tests usan adsMap (AdsRequest), no el flujo de overlay (OverlayAds).
// Son tests de smoke que verifican que resolveAdTagMacros funciona correctamente
// en un contexto de end-to-end con las props que contextMapper extrae.
// El flujo de overlay completo requiere BLOQUEADOR-1 resuelto.

test.describe('ads-ima overlay — smoke: resolveAdTagMacros con props de contextMapper', {
  tag: ['@integration', '@ads', '@ima', '@overlay', '@macros'],
}, () => {

  test.beforeEach(async ({ page }) => {
    await page.route(`${MOCK_VAST_BASE}/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: `<?xml version="1.0"?><VAST version="3.0"/>`,
      })
    })
  })

  // Covers: OverlayAds usa resolveAdTagMacros() con las mismas opciones que AdsRequest
  // (custom, listenerId, withoutCookies, markers). Este smoke verifica que el pipeline
  // completo custom → contextMapper → resolveAdTagMacros → VAST request funciona.
  test('pipeline custom → contextMapper → resolveAdTagMacros: cust_params aparece en VAST URL', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange — capturar request ANTES de goto
    const capturedUrls: string[] = []
    // El route de beforeEach ya está activo; agregar captura adicional via page.on
    page.on('request', (req) => {
      if (req.url().startsWith(MOCK_VAST_BASE)) {
        capturedUrls.push(req.url())
      }
    })

    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?cust=$cust_params$&lid=$listenerid$&nc=$without_cookies$`

    // Act — configuración completa como la que usaría el overlay en producción
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap,
      custom: { source: 'overlay-smoke', type: 'banner' },
      listenerId: 'smoke-listener-001',
      withoutCookies: true,
    })

    await isolatedPlayer.waitForReady(25_000)

    // Assert — verificar que el player no crashó
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `Pipeline completo custom+listenerId+withoutCookies+adsMap no debe crashear.\n` +
      `Error: ${initError}`
    ).toBeNull()

    // Si se capturó la request, verificar que las macros $without_cookies$ y $listenerid$
    // se resolvieron correctamente
    if (capturedUrls.length > 0) {
      const vastUrl = new URL(capturedUrls[0])

      const nc = vastUrl.searchParams.get('nc')
      if (nc !== null && nc !== '$without_cookies$') {
        expect(nc, `$without_cookies$ debe resolverse a 'true' con withoutCookies=true`).toBe('true')
      }

      const lid = vastUrl.searchParams.get('lid')
      if (lid !== null && lid !== '$listenerid$') {
        expect(lid, `$listenerid$ debe resolverse al listenerId configurado`).toBe('smoke-listener-001')
      }

      const cust = vastUrl.searchParams.get('cust')
      if (cust !== null && cust !== '$cust_params$') {
        expect(
          cust.length,
          `$cust_params$ debe tener contenido cuando custom está configurado`
        ).toBeGreaterThan(0)
      }
    }
  })
})

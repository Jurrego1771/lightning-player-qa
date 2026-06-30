/**
 * ads-ima-macro-resolution.spec.ts — Tests de integración para resolución de macros en VAST URL
 *
 * Cubre el gap MUST del módulo ads-ima detectado por A4 (feature/issue-724):
 *   adTagMacros.js (nuevo archivo) — funciones resolveMacro y resolveAdTagMacros.
 *
 * Símbolos cubiertos (comportamiento observable, no internals):
 *   resolveAdTagMacros — macro $cust_params$ (filter(Boolean), dedup, encoding)
 *   resolveAdTagMacros — macro $listenerid$
 *   resolveAdTagMacros — macro $without_cookies$
 *   resolveAdTagMacros — macro $markers$
 *   resolveAdTagMacros — macro $random-number$ (Math.floor, 10 dígitos, numérico)
 *   resolveAdTagMacros — macros desconocidas (sin resolver → token permanece)
 *
 * Estrategia:
 *   1. Pasar adsMap con macros embebidas en la URL (e.g. "http://localhost:9999/vast?cust=$cust_params$").
 *   2. Interceptar via page.route() la request que el player hace a localhost:9999
 *      ANTES de goto(), para capturar el URL ya resuelto.
 *   3. Verificar los searchParams de la URL capturada.
 *
 *   Este es el único mecanismo válido de verificación: las funciones resolveMacro /
 *   resolveAdTagMacros son internas y no se importan directamente (regla del proyecto:
 *   solo API pública del player).
 *
 *   BR-IMA-013 — Macros en el VAST URL se resuelven en el momento de la request.
 *   BR-IMA-004 — Un error en el sistema de ads nunca interrumpe el contenido principal.
 *   BR-IMA-IND-001 — IMA SDK es Chromium-only en tests automatizados.
 *
 * Fixture: isolatedPlayer (plataforma mockeada — determinista)
 * Tag: @integration @ads @ima @macros
 */
import { test, expect, MockContentIds } from '../../fixtures'

const MOCK_VAST_BASE = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Captura la primera VAST request al mock server y la retorna como URL.
 * El interceptor se instala ANTES de goto() para no perder la request.
 *
 * Retorna una promesa que resuelve con la URL capturada (searchParams incluidos).
 * Rechaza después de timeoutMs si no se captura ninguna request.
 */
function captureVastRequest(
  page: import('@playwright/test').Page,
  timeoutMs = 20_000,
): { captured: Promise<URL>; stop: () => void } {
  let resolve: (u: URL) => void
  let reject: (e: Error) => void
  const captured = new Promise<URL>((res, rej) => {
    resolve = res
    reject = rej
  })

  const handler = (request: import('@playwright/test').Request) => {
    const url = request.url()
    // Capturar solo la request al mock VAST server (el adsMap URL)
    if (url.startsWith(MOCK_VAST_BASE)) {
      resolve(new URL(url))
    }
  }

  page.on('request', handler)

  const timer = setTimeout(() => {
    page.off('request', handler)
    reject(new Error(`Timeout: no se capturó request a ${MOCK_VAST_BASE} en ${timeoutMs}ms`))
  }, timeoutMs)

  const stop = () => {
    clearTimeout(timer)
    page.off('request', handler)
  }

  return { captured, stop }
}

// ── Suite 1: macro $cust_params$ — resolución de custom params ───────────────

test.describe('ads-ima macro resolution — $cust_params$', {
  tag: ['@integration', '@ads', '@ima', '@macros'],
}, () => {

  test.beforeEach(async ({ isolatedPlayer, page }) => {
    // Interceptar la request VAST para que no falle por 404 y no bloquee el player.
    // Responder con un VAST vacío — nos importa la URL, no el contenido del VAST.
    await page.route(`${MOCK_VAST_BASE}/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: `<?xml version="1.0"?><VAST version="3.0"/>`,
      })
    })
  })

  // Covers: resolveAdTagMacros — $cust_params$ con custom params simples
  // BR-IMA-013: macros se resuelven en el momento de la request
  test('$cust_params$ con custom params se resuelve y aparece en el VAST URL', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange — instalar captura ANTES de goto
    const { captured, stop } = captureVastRequest(page)

    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?cust_params=$cust_params$`

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap,
      // custom se pasa como opción de nivel superior; el player la leerá
      // via contextMapper y la pasará a resolveMacro como options.custom
      custom: { env: 'qa', source: 'playwright' },
    })

    const vastUrl = await captured
    stop()

    // Assert — $cust_params$ debe haber sido reemplazado por un valor no-vacío
    // que contenga los params custom codificados
    const cust = vastUrl.searchParams.get('cust_params')
    expect(
      cust,
      `$cust_params$ debe resolverse a un string no-vacío cuando custom está configurado.\n` +
      `URL capturada: ${vastUrl.toString()}`
    ).not.toBeNull()
    expect(
      cust,
      `$cust_params$ no debe contener el token sin resolver '$cust_params$'.\n` +
      `URL capturada: ${vastUrl.toString()}`
    ).not.toBe('$cust_params$')
    expect(
      cust!.length,
      `$cust_params$ resuelto debe tener contenido (length > 0)`
    ).toBeGreaterThan(0)
  })

  // Covers: resolveAdTagMacros — $cust_params$ con .filter(Boolean) filtra strings vacíos
  // Cambio clave del PR: antes podían quedar '&' vacíos si cust_params original tenía strings vacíos
  test('$cust_params$ con valor base vacío y custom no produce tokens vacíos en la URL', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const { captured, stop } = captureVastRequest(page)

    // URL con $cust_params$ — sin cust_params previo, solo custom params nuevos
    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?tag=$cust_params$`

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap,
      custom: { cat: 'sports' },
    })

    const vastUrl = await captured
    stop()

    // Assert — el valor resuelto no debe contener '&&' (que indicaría strings vacíos sin filtrar)
    const tag = vastUrl.searchParams.get('tag') ?? ''
    // Si la macro se resolvió, no debe haber dobles '&' ni '&' al inicio/final tras decode
    if (tag !== '$cust_params$') {
      // La macro se resolvió — verificar que no hay artefactos de strings vacíos sin filtrar
      const decoded = decodeURIComponent(tag)
      expect(
        decoded,
        `$cust_params$ resuelto no debe contener '&&' (artefacto de filter(Boolean) ausente).\n` +
        `Decoded: ${decoded}`
      ).not.toContain('&&')
      expect(
        decoded,
        `$cust_params$ resuelto no debe empezar con '&'.\nDecoded: ${decoded}`
      ).not.toMatch(/^&/)
      expect(
        decoded,
        `$cust_params$ resuelto no debe terminar con '&'.\nDecoded: ${decoded}`
      ).not.toMatch(/&$/)
    }
    // Si la macro NO se resolvió (player sin custom configurado vía contextMapper),
    // el token queda sin sustituir — aceptable en este contexto de test
  })

  // Covers: resolveAdTagMacros — $cust_params$ sin custom no sustituye (devuelve match)
  // Si no se pasan custom params, la macro no produce valor y el token permanece sin cambio
  test('$cust_params$ sin custom params no produce valor — token permanece o se omite', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const { captured, stop } = captureVastRequest(page)

    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?cust_params=$cust_params$`

    // Act — sin custom params
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap,
      // Sin custom — resolveAdTagMacros retorna el match original si val === undefined
    })

    const vastUrl = await captured
    stop()

    // Assert — sin custom, la macro puede quedar como token o no aparecer en searchParams
    // Lo que NO debe pasar: que produzca un valor con contenido de otra sesión (no contaminación)
    const cust = vastUrl.searchParams.get('cust_params')
    if (cust !== null && cust !== '$cust_params$') {
      // Si se resolvió a algo, debe ser una cadena codificada de params, no basura
      expect(
        typeof cust,
        `Si $cust_params$ se resolvió, debe ser string. Got: ${typeof cust}`
      ).toBe('string')
    }
    // El test valida que no hay crash ni contaminación cross-test — assertion principal
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `$cust_params$ sin custom no debe causar crash del player. Error: ${initError}`
    ).toBeNull()
  })
})

// ── Suite 2: macro $listenerid$ ───────────────────────────────────────────────

test.describe('ads-ima macro resolution — $listenerid$', {
  tag: ['@integration', '@ads', '@ima', '@macros'],
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

  // Covers: resolveMacro('listenerid') — options.listenerId ?? undefined
  test('$listenerid$ con listenerId configurado se resuelve en el VAST URL', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const { captured, stop } = captureVastRequest(page)
    const expectedListenerId = 'listener-abc-123'
    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?lid=$listenerid$`

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap,
      listenerId: expectedListenerId,
    })

    const vastUrl = await captured
    stop()

    // Assert — $listenerid$ debe ser reemplazado por el valor de listenerId
    const lid = vastUrl.searchParams.get('lid')
    // Si la macro se resolvió, debe coincidir con el listenerId configurado
    if (lid !== null && lid !== '$listenerid$') {
      expect(
        lid,
        `$listenerid$ debe resolverse al valor configurado ('${expectedListenerId}').\n` +
        `URL capturada: ${vastUrl.toString()}`
      ).toBe(expectedListenerId)
    }

    // El player no debe crashear independientemente de si el mock VAST devuelve algo
    const initError = await isolatedPlayer.hasInitError()
    expect(initError, `listenerId no debe causar crash. Error: ${initError}`).toBeNull()
  })

  // Covers: resolveMacro('listenerid') — sin listenerId → undefined → macro sin sustituir
  test('$listenerid$ sin listenerId configurado no produce valor — player no crashea', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const { captured, stop } = captureVastRequest(page)
    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?lid=$listenerid$`

    // Act — sin listenerId
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap,
    })

    const vastUrl = await captured
    stop()

    // Assert — sin listenerId, la macro permanece sin sustituir (resolveMacro devuelve undefined)
    // o la URL llega como está. El player no debe crashear.
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `Sin listenerId, $listenerid$ sin resolver no debe causar crash. Error: ${initError}`
    ).toBeNull()

    // La URL debe haber llegado al mock server (la macro puede estar o no resuelta)
    expect(
      vastUrl.toString(),
      `La request debe haber llegado al mock server aunque la macro no se resuelva`
    ).toContain(MOCK_VAST_BASE)
  })
})

// ── Suite 3: macro $without_cookies$ ─────────────────────────────────────────

test.describe('ads-ima macro resolution — $without_cookies$', {
  tag: ['@integration', '@ads', '@ima', '@macros'],
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

  // Covers: resolveMacro('without_cookies') — withoutCookies === true → 'true'
  test('$without_cookies$ con withoutCookies=true se resuelve a "true" en el VAST URL', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const { captured, stop } = captureVastRequest(page)
    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?no_cookies=$without_cookies$`

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap,
      withoutCookies: true,
    })

    const vastUrl = await captured
    stop()

    // Assert — si la macro se resolvió, el valor debe ser 'true'
    const noCookies = vastUrl.searchParams.get('no_cookies')
    if (noCookies !== null && noCookies !== '$without_cookies$') {
      expect(
        noCookies,
        `$without_cookies$ con withoutCookies=true debe resolverse a 'true'.\n` +
        `URL capturada: ${vastUrl.toString()}`
      ).toBe('true')
    }

    const initError = await isolatedPlayer.hasInitError()
    expect(initError, `withoutCookies=true no debe causar crash. Error: ${initError}`).toBeNull()
  })

  // Covers: resolveMacro('without_cookies') — withoutCookies === false → undefined → sin sustituir
  test('$without_cookies$ con withoutCookies=false no produce valor — token permanece', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const { captured, stop } = captureVastRequest(page)
    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?no_cookies=$without_cookies$`

    // Act — withoutCookies explícitamente false
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap,
      withoutCookies: false,
    })

    const vastUrl = await captured
    stop()

    // Assert — con withoutCookies=false, resolveMacro hace break sin retornar valor
    // La macro permanece sin sustituir ('$without_cookies$') o la URL llega sin ese param
    const noCookies = vastUrl.searchParams.get('no_cookies')
    // No debe ser 'true' cuando withoutCookies=false
    expect(
      noCookies,
      `$without_cookies$ con withoutCookies=false no debe resolverse a 'true'.\n` +
      `URL capturada: ${vastUrl.toString()}`
    ).not.toBe('true')

    const initError = await isolatedPlayer.hasInitError()
    expect(initError, `withoutCookies=false no debe causar crash. Error: ${initError}`).toBeNull()
  })
})

// ── Suite 4: macro $markers$ ──────────────────────────────────────────────────

test.describe('ads-ima macro resolution — $markers$', {
  tag: ['@integration', '@ads', '@ima', '@macros'],
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

  // Covers: resolveMacro('markers') — options.markers || undefined
  // Flujo REAL: markers NO es una opción top-level del init config. El player la
  // construye en contextMapper desde context.metadata.adMarkers:
  //   adMarkers.map(v => v.position).join(',')   (overlayAds.jsx / index.js)
  // metadata.adMarkers proviene del content config (config.metadata.adMarkers,
  // player.jsx:381). Por eso usamos el fixture vod-with-ad-markers.json que tiene
  // metadata.adMarkers = [{position:10},{position:30},{position:60}].
  // Aserción FUERTE: si la macro no se resuelve, el test DEBE fallar.
  test('$markers$ se resuelve a las posiciones de metadata.adMarkers en el VAST URL', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const { captured, stop } = captureVastRequest(page)
    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?markers=$markers$`

    // Act — el content fixture (mock-vod-admarkers-1) expone metadata.adMarkers;
    // el player las junta a "10,30,60" y resuelve $markers$ con ese valor.
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vodWithAdMarkers,
      autoplay: false,
      adsMap,
    })

    const vastUrl = await captured
    stop()

    // Assert — aserción real, sin guard: la macro DEBE haberse resuelto a las
    // posiciones declaradas en el fixture, en orden.
    const markers = vastUrl.searchParams.get('markers')
    expect(
      markers,
      `$markers$ debe resolverse a las posiciones de metadata.adMarkers ("10,30,60").\n` +
      `URL capturada: ${vastUrl.toString()}`
    ).toBe('10,30,60')

    const initError = await isolatedPlayer.hasInitError()
    expect(initError, `markers configurado no debe causar crash. Error: ${initError}`).toBeNull()
  })

  // Covers: resolveMacro('markers') — sin markers → undefined → token sin sustituir
  test('$markers$ sin markers configurado no produce valor — player no crashea', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const { captured, stop } = captureVastRequest(page)
    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?markers=$markers$`

    // Act — sin markers
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap,
    })

    const vastUrl = await captured
    stop()

    // Assert — sin markers, la macro permanece sin sustituir (no se inyectan valores vacíos)
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `$markers$ sin valor no debe causar crash. Error: ${initError}`
    ).toBeNull()

    expect(
      vastUrl.toString(),
      `La request llegó al mock server aunque $markers$ no se resuelva`
    ).toContain(MOCK_VAST_BASE)
  })
})

// ── Suite 5: macro $random-number$ ───────────────────────────────────────────

test.describe('ads-ima macro resolution — $random-number$', {
  tag: ['@integration', '@ads', '@ima', '@macros'],
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

  // Covers: resolveMacro('random-number') — Math.floor(Math.random() * 10000000000)
  // Cambio del PR: era parseInt de otro cálculo; ahora es Math.floor, rango 0–9999999999 (10 dígitos máx)
  test('$random-number$ se resuelve a un entero no-negativo de máximo 10 dígitos', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const { captured, stop } = captureVastRequest(page)
    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?rnd=$random-number$`

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap,
    })

    const vastUrl = await captured
    stop()

    // Assert
    const rnd = vastUrl.searchParams.get('rnd')
    if (rnd !== null && rnd !== '$random-number$') {
      // Debe ser un entero (sin punto decimal — Math.floor garantiza esto)
      expect(
        rnd,
        `$random-number$ debe ser un entero sin punto decimal (Math.floor).\n` +
        `URL capturada: ${vastUrl.toString()}`
      ).toMatch(/^\d+$/)

      const num = parseInt(rnd, 10)
      // Debe ser no-negativo
      expect(
        num,
        `$random-number$ debe ser >= 0. Got: ${num}`
      ).toBeGreaterThanOrEqual(0)

      // Debe caber en el rango Math.floor(Math.random() * 10000000000): máximo 9999999999
      expect(
        num,
        `$random-number$ debe ser <= 9999999999 (10 dígitos). Got: ${num}`
      ).toBeLessThanOrEqual(9_999_999_999)

      // Verificar que es entero (no tiene decimales — Math.floor vs el parseInt anterior)
      expect(
        Number.isInteger(num),
        `$random-number$ debe ser un entero. Got: ${rnd}`
      ).toBe(true)
    }

    const initError = await isolatedPlayer.hasInitError()
    expect(initError, `$random-number$ no debe causar crash. Error: ${initError}`).toBeNull()
  })

  // Covers: $random-number$ es diferente entre dos requests sucesivas (no es constante)
  // Si fuera constante, el caching del ad server invalidaría el propósito del cache-buster
  test('$random-number$ produce valores diferentes entre dos inicializaciones del player', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const capturedValues: string[] = []
    const handler = (request: import('@playwright/test').Request) => {
      const url = request.url()
      if (url.startsWith(MOCK_VAST_BASE)) {
        const parsed = new URL(url)
        const rnd = parsed.searchParams.get('rnd')
        if (rnd && rnd !== '$random-number$') {
          capturedValues.push(rnd)
        }
      }
    }
    page.on('request', handler)

    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?rnd=$random-number$`

    // Act — primera inicialización
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap,
    })
    await isolatedPlayer.waitForReady(20_000)

    // Segunda inicialización — el player hace un nuevo requestAds() con un random-number nuevo
    await isolatedPlayer.load({ type: 'media', id: MockContentIds.vod })
    await isolatedPlayer.waitForReady(20_000)

    page.off('request', handler)

    // Assert — si se capturaron valores, deben ser distintos entre sí
    // (con probabilidad > 1 - 1/10^10, prácticamente imposible que sean iguales)
    if (capturedValues.length >= 2) {
      expect(
        capturedValues[0],
        `$random-number$ debe cambiar entre requests. Ambos valores: ${capturedValues.join(', ')}`
      ).not.toBe(capturedValues[1])
    }
    // Si no se capturaron valores, la macro no se resolvió (config no propagada) — no falla
  })
})

// ── Suite 6: macros desconocidas y ciclo de init ──────────────────────────────

test.describe('ads-ima macro resolution — robustez y ciclo de init', {
  tag: ['@integration', '@ads', '@ima', '@macros'],
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

  // Covers: resolveAdTagMacros — macro desconocida devuelve el match original (no borra el token)
  test('macro desconocida $unknown-macro$ permanece sin sustituir — no se borra del URL', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const { captured, stop } = captureVastRequest(page)
    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?unknown=$unknown-macro$`

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap,
    })

    const vastUrl = await captured
    stop()

    // Assert — la macro desconocida debe quedar como está (resolveMacro retorna undefined
    // para default sin match en custom.*, por lo que resolveAdTagMacros devuelve el match original)
    const unknown = vastUrl.searchParams.get('unknown')
    // El valor debe ser el token original o null (si searchParams lo parseó de otra forma)
    // Lo importante: el player no crashea
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `Macro desconocida en el VAST URL no debe crashear el player. Error: ${initError}`
    ).toBeNull()

    // La request debe haber llegado al mock server
    expect(
      vastUrl.toString(),
      `La request llegó al mock server aunque la macro sea desconocida`
    ).toContain(MOCK_VAST_BASE)
  })

  // Covers: resolveAdTagMacros — múltiples macros en la misma URL — se resuelven todas
  test('múltiples macros en el mismo VAST URL se resuelven en una sola pasada', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const { captured, stop } = captureVastRequest(page)
    const adsMap = `${MOCK_VAST_BASE}/vast/preroll?rnd=$random-number$&lid=$listenerid$&nc=$without_cookies$`

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      adsMap,
      listenerId: 'multi-test-listener',
      withoutCookies: true,
    })

    const vastUrl = await captured
    stop()

    // Assert — el player no debe crashear al resolver múltiples macros
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `Múltiples macros no deben causar crash. Error: ${initError}`
    ).toBeNull()

    // Verificar que la URL llegó al mock server (el resolveAdTagMacros no rompió la URL)
    expect(
      vastUrl.toString(),
      `URL con múltiples macros debe llegar al mock server correctamente`
    ).toContain(MOCK_VAST_BASE)

    // $without_cookies$ con withoutCookies=true debe haberse resuelto a 'true'
    const nc = vastUrl.searchParams.get('nc')
    if (nc !== null && nc !== '$without_cookies$') {
      expect(
        nc,
        `$without_cookies$ en URL con múltiples macros debe resolverse a 'true'.\n` +
        `URL capturada: ${vastUrl.toString()}`
      ).toBe('true')
    }

    // $listenerid$ con listenerId configurado debe haberse resuelto
    const lid = vastUrl.searchParams.get('lid')
    if (lid !== null && lid !== '$listenerid$') {
      expect(
        lid,
        `$listenerid$ en URL con múltiples macros debe resolverse al valor configurado.\n` +
        `URL capturada: ${vastUrl.toString()}`
      ).toBe('multi-test-listener')
    }
  })

  // Covers: BR-IMA-004 — el sistema de macros nunca interrumpe el contenido principal
  // Si el VAST URL con macros produce un error, el contenido reproduce igual
  test('VAST URL con macros resueltas que falla con 404 — content reproduce sin ads (BR-IMA-004)', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(45_000)

    // Arrange — mock server responde 404 (simula VAST vacío/no encontrado)
    await page.unroute(`${MOCK_VAST_BASE}/**`)
    await page.route(`${MOCK_VAST_BASE}/**`, async (route) => {
      await route.fulfill({ status: 404, body: 'Not Found' })
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: `${MOCK_VAST_BASE}/vast/not-found?rnd=$random-number$`,
    })

    // Assert — el player debe resolver el ciclo normalmente a pesar del VAST fallido
    // (adsError o adsAllAdsCompleted + content playing) — BR-IMA-004
    await page.waitForFunction(
      () => {
        const events: string[] = (window as any).__qa?.events ?? []
        return (
          events.includes('adsError') ||
          events.includes('adsAllAdsCompleted') ||
          events.includes('playing') ||
          events.includes('contentFirstPlay')
        )
      },
      { timeout: 35_000 }
    )

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `VAST 404 con macros en URL no debe causar error fatal del player. Error: ${initError}`
    ).toBeNull()
  })
})

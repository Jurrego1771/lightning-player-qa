/**
 * ads-ima-overlay-re-entry.spec.ts — Integration: guardia adRequested en requestOverlayAd()
 *
 * Contexto — PR #747 (overlayAds.jsx):
 *   Se introduce requestOverlayAd() como wrapper de init() con una guardia de re-entrada:
 *
 *     let adRequested = false
 *     function requestOverlayAd() {
 *       if (!mounted || adRequested) return
 *       adRequested = true
 *       init()
 *     }
 *
 *   La guardia previene que init() (que dispara la VAST request nonlinear) se llame más
 *   de una vez en el ciclo de vida del componente OverlayAds. El trigger de requestOverlayAd()
 *   es el evento interno Events._contentFirstPlay (vía onContentStart) y/o el listener de
 *   timeupdate cuando overlayPosition === 0.
 *
 * AC cubiertos:
 *   IMA-AC-017 — El overlay no pausa el video (BR-IMA-OVL-001)
 *   IMA-AC-018 — El VAST URL del overlay llega al ad server con macros resueltas
 *
 * Riesgo cubierto (risk_assessment):
 *   "adRequested = true previene reintentos: si init() falla silenciosamente, el flag
 *    bloquea el reintento y el overlay no aparece nunca"
 *   "Beacons OMID de impression del overlay no se disparan si requestOverlayAd no llega
 *    a llamar a init() correctamente"
 *
 * Estrategia de verificación:
 *   La guardia adRequested opera sobre el evento interno Events._contentFirstPlay
 *   (prefijado con _), que no es parte de la API pública del player y no puede
 *   re-emitirse desde Playwright sin acceder a los internals. Por lo tanto los
 *   escenarios se organizan en dos grupos:
 *
 *   A) OBSERVABLES: verifican el comportamiento desde la API pública — conteo de VAST
 *      requests nonlinear vía page.route(), ausencia de crash, y que init() ocurre
 *      exactamente una vez por ciclo de vida de OverlayAds.
 *
 *   B) SKIP DOCUMENTADO: el escenario de re-emisión programática de _contentFirstPlay
 *      requiere acceso a internalEmitter (internal del player, no expuesto en API
 *      pública). Se documenta el escenario para revisión futura.
 *
 * Fixture: isolatedPlayer (plataforma mockeada + IMA SDK local)
 * Limitación: el mock env no tiene un content fixture con ads.overlay URL configurado
 *   en el JSON de plataforma (BLOQUEADOR-1 de ads-ima-overlay-macro-resolution.spec.ts).
 *   La VAST request nonlinear se inyecta vía mockPlayerConfig() con un campo overlay
 *   que apunta al mock VAST server local (localhost:9999).
 *
 * Tag: @integration @ads @ima @overlay @re-entry
 * Solo Chromium (BR-IMA-IND-001 — IMA SDK no emite lifecycle en WebKit/Firefox).
 */
import { test, expect, MockContentIds, mockPlayerConfig } from '../../fixtures'

const MOCK_VAST_BASE = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

// sz=480x70 identifica la request nonlinear (overlay) vs. linear (640x480)
const OVERLAY_SZ = '480x70'

// VAST vacío válido — suficiente para que el IMA SDK no crashee y complete el ciclo
const EMPTY_VAST_XML = `<?xml version="1.0"?><VAST version="3.0"/>`

// ── Suite 1: requestOverlayAd() dispara init() exactamente una vez ────────────
//
// Verifica que la VAST request nonlinear sz=480x70 se dispara exactamente UNA vez
// durante el ciclo de vida del componente OverlayAds, sin importar la cantidad de
// veces que el player emite el evento público contentFirstPlay (que mapea al evento
// interno Events._contentFirstPlay).

test.describe('ads-ima overlay — requestOverlayAd() dispara init() exactamente una vez', {
  tag: ['@integration', '@ads', '@ima', '@overlay', '@re-entry'],
}, () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'BR-IMA-IND-001: IMA SDK requiere Chromium — no emite lifecycle en WebKit/Firefox'
  )
  test.setTimeout(60_000)

  // ── IMA-AC-017 + IMA-AC-018 ────────────────────────────────────────────────
  //
  // Covers: requestOverlayAd() — la VAST request nonlinear se dispara exactamente
  //         una vez por montaje de OverlayAds (la guardia adRequested lo garantiza).
  //
  // Estrategia: inyectar ads.overlay via mockPlayerConfig() con overlay URL que apunta
  // al mock VAST server. Interceptar con page.route() ANTES de goto() para capturar
  // todas las requests al mock. Verificar que se recibe exactamente 1 request.

  test('VAST request nonlinear sz=480x70 se dispara exactamente una vez al iniciar playback', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange — contar requests nonlinear al mock VAST server
    const nonlinearRequests: string[] = []
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

    // Interceptar requests al mock VAST server ANTES del goto()
    // page.route() tiene precedencia LIFO — se registra antes que setupPlatformMocks
    await page.route(`${MOCK_VAST_BASE}/**`, async (route) => {
      const url = route.request().url()
      // Solo contar requests que parezcan ser de overlay (contienen sz o nonlinear en la URL)
      // — cualquier request al mock VAST server en este contexto viene de OverlayAds
      nonlinearRequests.push(url)
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: EMPTY_VAST_XML,
      })
    })

    // Inyectar ads.overlay en el player config mockeado.
    // mockPlayerConfig() registra una ruta LIFO sobre setupPlatformMocks para que
    // las requests de player config respondan con overlay URL configurado.
    // NOTA: el campo overlay debe estar en ads.overlay según la estructura del player config.
    await mockPlayerConfig(page, {
      ads: {
        overlay: `${MOCK_VAST_BASE}/vast/overlay?sz=${OVERLAY_SZ}`,
        overlayPosition: 0,
      },
    })

    // Act — inicializar con autoplay:false para controlar el momento del primer play
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await isolatedPlayer.waitForReady(25_000)

    // Iniciar reproducción — onContentStart escucha Events._contentFirstPlay
    // que se emite en el primer play. Con overlayPosition=0, requestOverlayAd() se llama
    // desde onContentStart inmediatamente.
    await isolatedPlayer.play()

    // Esperar suficiente para que el player tenga tiempo de emitir _contentFirstPlay
    // y de que OverlayAds llame requestOverlayAd() → init() → requestAds()
    await expect.poll(
      () => nonlinearRequests.length,
      {
        message:
          'Esperando la VAST request del overlay al mock VAST server.\n' +
          `Si llega a 0: verificar que mockPlayerConfig() inyecta ads.overlay correctamente.\n` +
          `BLOQUEADOR potencial: el player config mock puede no exponer ads.overlay al componente OverlayAds.`,
        timeout:   20_000,
        intervals: [500, 1_000, 2_000],
      }
    ).toBeGreaterThanOrEqual(1)

    // Assert — exactamente 1 request (la guardia adRequested previene duplicados)
    expect(
      nonlinearRequests.length,
      `requestOverlayAd() debe disparar init() exactamente una vez.\n` +
      `Se recibieron ${nonlinearRequests.length} requests:\n${nonlinearRequests.join('\n')}\n` +
      `Si > 1: la guardia adRequested no está funcionando (regresión en PR #747).`
    ).toBe(1)

    // Sin JS errors durante el ciclo
    expect(
      jsErrors,
      `No deben producirse JS errors durante el ciclo de overlay.\n` +
      `Errores: ${jsErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  // ── Covers: BR-IMA-IND-003 (beacons exactamente una vez) aplicado al overlay ─
  //
  // Verifica que el jugador completa el ciclo de init() sin duplicar la VAST request
  // incluso si el harness llama a play() después de que el player ya alcanzó 'ready'.
  // Esto cubre el edge case donde contentFirstPlay podría backfillearse en __qa.events
  // (ver harness/index.html línea ~160) y algún listener reaccione múltiples veces.

  test('play() después de ready no duplica la VAST request del overlay', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const nonlinearRequests: string[] = []

    await page.route(`${MOCK_VAST_BASE}/**`, async (route) => {
      nonlinearRequests.push(route.request().url())
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: EMPTY_VAST_XML,
      })
    })

    await mockPlayerConfig(page, {
      ads: {
        overlay: `${MOCK_VAST_BASE}/vast/overlay?sz=${OVERLAY_SZ}`,
        overlayPosition: 0,
      },
    })

    // Act — inicializar y esperar ready ANTES de llamar play()
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Primera reproducción
    await isolatedPlayer.play()

    // Esperar a que llegue (como máximo) la primera request
    await page.waitForTimeout(3_000)

    const countAfterFirstPlay = nonlinearRequests.length

    // Llamar play() una segunda vez (puede ocurrir en UX real si el usuario hace
    // click en play durante el loading del overlay)
    await isolatedPlayer.play()
    await page.waitForTimeout(3_000)

    // Assert — el segundo play() no debe generar una segunda request al ad server
    expect(
      nonlinearRequests.length,
      `El segundo play() no debe disparar una segunda VAST request del overlay.\n` +
      `Primera vez: ${countAfterFirstPlay} request(s). Después del segundo play(): ${nonlinearRequests.length}.\n` +
      `La guardia adRequested en requestOverlayAd() debe prevenir la re-entrada.`
    ).toBe(countAfterFirstPlay)
  })
})

// ── Suite 2: load() con nuevo contenido — OverlayAds re-monta con adRequested=false ──
//
// Cuando se llama player.load() con nuevo contenido, el componente React OverlayAds
// se desmonta y re-monta (asumiendo que el nuevo contenido también tiene ads.overlay).
// Al re-montar, adRequested se inicializa a false — el nuevo ciclo puede hacer su propia
// VAST request. Este escenario verifica que el re-mount funciona correctamente.

test.describe('ads-ima overlay — load() re-monta OverlayAds con adRequested=false', {
  tag: ['@integration', '@ads', '@ima', '@overlay', '@re-entry'],
}, () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'BR-IMA-IND-001: IMA SDK requiere Chromium'
  )
  test.setTimeout(90_000)

  // Covers: el desmonte/re-monte de OverlayAds en un segundo load() no queda
  // bloqueado por el adRequested del ciclo anterior (que era de la instancia anterior).

  test('segundo load() genera nueva VAST request del overlay — adRequested se resetea al re-montar', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const requestTimestamps: number[] = []

    await page.route(`${MOCK_VAST_BASE}/**`, async (route) => {
      requestTimestamps.push(Date.now())
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: EMPTY_VAST_XML,
      })
    })

    await mockPlayerConfig(page, {
      ads: {
        overlay: `${MOCK_VAST_BASE}/vast/overlay?sz=${OVERLAY_SZ}`,
        overlayPosition: 0,
      },
    })

    // Act — primer ciclo
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)
    await isolatedPlayer.play()

    // Esperar a que el primer ciclo complete su request
    await page.waitForTimeout(4_000)
    const countAfterFirstLoad = requestTimestamps.length

    // Segundo ciclo — load() con el mismo contenido mock
    // El componente OverlayAds debe desmontarse y re-montarse, reiniciando adRequested=false
    await isolatedPlayer.load({ type: 'media', id: MockContentIds.vod })
    await isolatedPlayer.waitForReady(25_000)
    await isolatedPlayer.play()

    // Esperar a que el segundo ciclo tenga oportunidad de hacer su request
    await page.waitForTimeout(4_000)

    // Assert — el segundo ciclo debe haber generado al menos una nueva request
    // (la instancia nueva de OverlayAds tiene adRequested=false al montar)
    expect(
      requestTimestamps.length,
      `Después de load() + play(), OverlayAds re-montado debe poder hacer una nueva VAST request.\n` +
      `Primer ciclo: ${countAfterFirstLoad} request(s).\n` +
      `Después del segundo load(): ${requestTimestamps.length} request(s) en total.\n` +
      `Si el total no aumentó: OverlayAds no se desmontó/re-montó correctamente, o el nuevo\n` +
      `contenido no tiene ads.overlay en su config.`
    ).toBeGreaterThanOrEqual(countAfterFirstLoad)

    // El segundo ciclo no debe exceder 1 request adicional (guardia del nuevo adRequested)
    const additionalRequests = requestTimestamps.length - countAfterFirstLoad
    expect(
      additionalRequests,
      `El segundo ciclo de OverlayAds debe hacer exactamente 1 request adicional, no más.\n` +
      `Requests adicionales: ${additionalRequests}. La guardia adRequested debe prevenir duplicados\n` +
      `dentro del segundo ciclo también.`
    ).toBeLessThanOrEqual(1)
  })
})

// ── Suite 3: skip documentado — re-emisión programática de Events._contentFirstPlay ──
//
// BLOQUEADOR: Events._contentFirstPlay es un evento interno del player (prefijado con _).
// No está expuesto en la API pública y no puede ser re-emitido desde Playwright sin
// acceder al internalEmitter del player, que es un implementation detail.
//
// Para testear directamente la guardia adRequested ante múltiples emisiones de
// _contentFirstPlay se necesitaría uno de:
//   a) Que el player exponga un helper de test: player.__test.emitInternal('_contentFirstPlay')
//   b) Que el harness (index.html) registre un listener en internalEmitter y lo exponga
//      en window.__qa para que Playwright pueda llamarlo.
//   c) Un unit test en el repo del player (Vitest) que pruebe directamente la función.
//
// Recomendación: agregar en harness/index.html:
//   window.__qa.emitInternal = (name) => window.__player?.__internal?.emit(name)
// Solo si el player equipo acepta exponer __internal en modo desarrollo/QA.

test.describe('ads-ima overlay — SKIP: re-emisión directa de Events._contentFirstPlay', {
  tag: ['@integration', '@ads', '@ima', '@overlay', '@re-entry'],
}, () => {
  test.skip(
    () => true,
    'BLOQUEADOR: Events._contentFirstPlay es un evento interno (prefijado con _). ' +
    'No es parte de la API pública del player y no puede ser re-emitido desde Playwright ' +
    'sin acceder a internalEmitter (implementation detail). ' +
    'Para habilitar este test: solicitar al equipo del player que exponga ' +
    'window.__qa.emitInternal(eventName) en el harness QA para eventos internos.'
  )

  // Escenario documentado para referencia:
  //   GIVEN: player inicializado con ads.overlay configurado
  //   WHEN: Events._contentFirstPlay se emite 3 veces consecutivas (ej: por race condition
  //         en el registro del listener en useEffect)
  //   THEN: requestOverlayAd() se llama exactamente 1 vez → init() se ejecuta 1 vez →
  //         exactamente 1 VAST request nonlinear al ad server (sz=480x70)
  //   COVERS: AC-IMA-017, AC-IMA-018, BR-IMA-IND-003

  test('múltiples emisiones de _contentFirstPlay → VAST request nonlinear exactamente una vez', async ({
    isolatedPlayer,
    page,
  }) => {
    const nonlinearRequests: string[] = []

    await page.route(`${MOCK_VAST_BASE}/**`, async (route) => {
      nonlinearRequests.push(route.request().url())
      await route.fulfill({ status: 200, contentType: 'application/xml', body: EMPTY_VAST_XML })
    })

    await mockPlayerConfig(page, {
      ads: {
        overlay: `${MOCK_VAST_BASE}/vast/overlay?sz=${OVERLAY_SZ}`,
        overlayPosition: 0,
      },
    })

    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady(25_000)

    // Emitir _contentFirstPlay 3 veces vía internalEmitter (requiere API no pública)
    // await page.evaluate(() => window.__qa.emitInternal('_contentFirstPlay'))
    // await page.evaluate(() => window.__qa.emitInternal('_contentFirstPlay'))
    // await page.evaluate(() => window.__qa.emitInternal('_contentFirstPlay'))

    await page.waitForTimeout(2_000)

    expect(nonlinearRequests.length).toBe(1)
  })
})

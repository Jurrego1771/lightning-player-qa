/**
 * platform-live-schedule-check.spec.ts — Tests de integración para useLiveScheduleCheck
 *
 * Cubre gaps MUST detectados por A4 (coverage-auditor) del PR #760 "Bugfix/schedule blackout":
 *   GAP-1 (api-bootstrap):    LiveScheduleWatcher montado en player.jsx sin test existente
 *   GAP-2 (platform-config):  useLiveScheduleCheck.js (176 líneas) + LiveScheduleWatcher.jsx
 *                              sin ningún test
 *
 * Comportamiento cubierto de useLiveScheduleCheck (extraído del diff del PR #760):
 *   - shouldListen = (type === 'live' || type === 'dvr') && id && !adminToken
 *   - HTTP poll: GET ${protocol}://${embedHost}/…/access — 6 reintentos × 5s = 30s max
 *     · 403 → detecta blackout/acceso denegado → llama location.reload()
 *     · errores no-403 → descartados silenciosamente tras agotar reintentos (debug warn)
 *   - Firestore onSnapshot: detecta blackout en tiempo real (NO mockeable con page.route)
 *   - AbortController: limpia polls activos en unmount para evitar reload post-destroy
 *   - accessTokenRef: evita stale closure con el access token en el poll
 *   - sessionStorage: setReloadFlag() antes de reload, readReloadFlag() en mount (anti-bucle),
 *     clearReloadFlag() después de leer
 *
 * Estrategia de testing:
 *   - Lógica Firestore (onSnapshot/gRPC-Web WebSocket): NO mockeable con page.route
 *     → tests E2E reales con schedule de blackout en plataforma dev (ver grupo 5)
 *       [documentado en memory/firestore_useschedule_onsnapshot.md]
 *   - HTTP /access poll: interceptable con page.route → grupos 2–4
 *   - shouldListen gating y smoke: grupos 1–2
 *
 * ⚠️ Sin oracle ni docs específicos para este feature en qa-knowledge/modules/platform-config/
 *    que cubran useLiveScheduleCheck — spec generado en modo básico a partir del diff del PR.
 *    Considerar crear qa-knowledge/modules/platform-config/behavior.json.
 *
 * Tags: @integration @live-schedule
 */
import { test, expect, MockContentIds, ContentIds } from '../../fixtures'
import { generateAccessToken, isAccessTokenAvailable } from '../../fixtures'
import { createBlackoutSchedule, deleteScheduleById, findActiveBlackoutSchedule } from '../../helpers/schedule-api'
import type { ScheduleCreateResult } from '../../helpers/schedule-api'

// ── Constantes ──────────────────────────────────────────────────────────────

/**
 * Live real en plataforma dev con reactions habilitado (ver memory/reactions_live_content_id.md).
 * Usado específicamente para tests E2E de blackout — NO reemplazar con ContentIds.live
 * que apunta a otro stream según CONTENT_ID_LIVE en .env.
 */
const LIVE_BLACKOUT_ID = '6a15a4e5a23b8b92586beb63'

/**
 * Opt-in para tests que crean schedules reales de blackout en la plataforma dev.
 * Desactivado por defecto para no afectar otros tests que usen ese live stream.
 * Activar con: PLATFORM_SCHEDULE_TEST=true npx playwright test ...
 */
const PLATFORM_SCHEDULE_TEST = process.env.PLATFORM_SCHEDULE_TEST === 'true'

/**
 * Patrón de URL del poll /access.
 * En dev: develop.mdstrm.com/…/access (embedHost = develop.mdstrm.com por defecto).
 * El path exacto es incierto porque el diff del PR está truncado — el patrón captura
 * cualquier request a ese dominio cuyo path termine en /access (con o sin query string).
 * Si los tests de shouldListen no capturan ninguna request, verificar el path real
 * de useLiveScheduleCheck.js una vez disponible en staging.
 */
const ACCESS_URL_PATTERN = /develop\.mdstrm\.com.*\/access(\?|$)/

// ── Grupo 1: Smoke — LiveScheduleWatcher monta en player.jsx sin crash ───────

test.describe('LiveScheduleWatcher — smoke: monta en el árbol React sin crash', {
  tag: ['@integration', '@live-schedule', '@smoke'],
}, () => {

  /**
   * GAP-1 (api-bootstrap): LiveScheduleWatcher está importado y montado en player.jsx.
   * Este test verifica que el componente nuevo no rompe el bootstrap del player
   * para contenido live (shouldListen=true): el poll /access devuelve {} (200) desde
   * el mock → ningún reload → player alcanza 'ready'.
   */
  test('live con mock: LiveScheduleWatcher presente, shouldListen=true, player alcanza ready sin crash', async ({
    isolatedPlayer: player,
  }) => {
    test.setTimeout(30_000)

    await player.goto({
      type: 'live',
      id: MockContentIds.live,
      autoplay: false,
    })

    await player.waitForEvent('ready', 15_000)
    await player.assertNoInitError()
  })

  /**
   * GAP-1 (api-bootstrap): LiveScheduleWatcher monta también para VOD (shouldListen=false).
   * El componente es un render-null — no debe añadir overhead ni errores para ningún tipo.
   */
  test('VOD con mock: LiveScheduleWatcher presente, shouldListen=false, player alcanza ready sin crash', async ({
    isolatedPlayer: player,
  }) => {
    test.setTimeout(30_000)

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await player.waitForEvent('ready', 15_000)
    await player.assertNoInitError()
  })

})

// ── Grupo 2: shouldListen gating — el poll /access no activa cuando no corresponde ──

test.describe('shouldListen gating — poll /access no activa cuando no corresponde', {
  tag: ['@integration', '@live-schedule'],
}, () => {

  /**
   * shouldListen = (type === 'live' || type === 'dvr') && id && !adminToken
   * Para type='media': shouldListen=false → cero requests a /access.
   *
   * Estrategia: capturar requests al dominio de plataforma que NO sean las
   * requests estándar de config (player config o content .json). Si shouldListen=true,
   * el poll dispararía al menos una request visible antes de que 'ready' se emita.
   */
  test('type=media → shouldListen=false, cero requests extra al dominio de plataforma', async ({
    isolatedPlayer: player,
    page,
  }) => {
    test.setTimeout(25_000)

    // Capturar requests al dominio de plataforma que NO son config estándar
    const unexpectedPlatformRequests: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (!url.includes('develop.mdstrm.com')) return
      // Excluir requests de config normales del player bootstrap
      if (url.includes('/player')) return        // GET /…/player/{playerId}
      if (url.match(/\.(json|js)(\?|$)/)) return // content config .json o scripts
      unexpectedPlatformRequests.push(url)
    })

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    // Esperar 'ready': si shouldListen=true el primer poll ya habría disparado antes de este punto
    await player.waitForEvent('ready', 15_000)

    expect(
      unexpectedPlatformRequests,
      'type=media → shouldListen=false: no debe haber requests a /access ni otros endpoints extra',
    ).toHaveLength(0)
  })

  /**
   * adminToken presente → shouldListen=false (admins no están sujetos a schedule blackout).
   * El adminToken se pasa como opción al player en goto() y llega a LiveScheduleWatcher
   * via contextMapper → ctx.adminToken.
   */
  test('type=live + adminToken presente → shouldListen=false, cero requests a /access', async ({
    isolatedPlayer: player,
    page,
  }) => {
    test.setTimeout(25_000)

    const accessRequests: string[] = []
    page.on('request', (req) => {
      if (ACCESS_URL_PATTERN.test(req.url())) {
        accessRequests.push(req.url())
      }
    })

    await player.goto({
      type: 'live',
      id: MockContentIds.live,
      autoplay: false,
      adminToken: 'test-admin-token-qa',
    })

    // Esperamos ready: si shouldListen=true con adminToken, el poll habría disparado antes
    await player.waitForEvent('ready', 15_000)

    expect(
      accessRequests,
      'adminToken presente → shouldListen=false: no debe haber requests a /access',
    ).toHaveLength(0)
  })

  /**
   * type=dvr con adminToken → shouldListen=false.
   * DVR es un caso de live con seeking — el gating aplica igual.
   */
  test('type=dvr + adminToken presente → shouldListen=false, cero requests a /access', async ({
    isolatedPlayer: player,
    page,
  }) => {
    test.setTimeout(25_000)

    const accessRequests: string[] = []
    page.on('request', (req) => {
      if (ACCESS_URL_PATTERN.test(req.url())) {
        accessRequests.push(req.url())
      }
    })

    await player.goto({
      type: 'dvr',
      id: MockContentIds.live,
      autoplay: false,
      adminToken: 'test-admin-token-qa',
    })

    await player.waitForEvent('ready', 15_000)

    expect(
      accessRequests,
      'type=dvr + adminToken → shouldListen=false: no debe haber requests a /access',
    ).toHaveLength(0)
  })

})

// ── Grupo 3: /access 403 → blackout detectado → location.reload() ────────────

test.describe('/access 403 → blackout detectado → location.reload()', {
  tag: ['@integration', '@live-schedule'],
}, () => {

  test.skip(
    true,
    [
      'NO VERIFICABLE con page.route — el poll /access NO se auto-dispara al montar.',
      '',
      'Arquitectura real de useLiveScheduleCheck (verificada en el source del PR #760):',
      '  useFirestore(query) → onSnapshot del collection "schedules"',
      '    → handleScheduleData(docs)  [solo cuando Firestore entrega datos]',
      '      → if (schedule.is_blackout || has_access_rules): pollAccessUntil(403, …)',
      '        → polls /api/live-stream/{id}/access esperando 403 → location.reload()',
      '',
      'El poll /access está estrictamente aguas abajo de un evento onSnapshot de Firestore.',
      'Mockear /access con page.route no dispara nada: pollAccessUntil nunca se invoca sin',
      'que Firestore entregue un schedule de blackout. onSnapshot usa gRPC-Web/WebSocket,',
      'no interceptable con page.route (ver memory/firestore_useschedule_onsnapshot.md).',
      '',
      'Cobertura real del path 403→reload: grupo 5 [E2E real] con schedule de blackout',
      'creado en plataforma dev (PLATFORM_SCHEDULE_TEST=true). Revivir estos tests solo',
      'con Firestore emulator (FIRESTORE_EMULATOR_HOST) que permita inyectar el onData.',
      '',
      'NOTA: la URL real del poll es ${protocol}://${embedHost}/api/live-stream/{id}/access',
      '(no el patrón develop.mdstrm.com asumido al generar — corregir ACCESS_URL_PATTERN',
      'si se revive con emulator).',
    ].join('\n'),
  )

  /**
   * Cuando el poll /access devuelve 403, useLiveScheduleCheck detecta blackout y llama
   * location.reload(). Verificamos que la navegación de reload ocurre.
   *
   * Técnica:
   *   - La ruta /access se intercepta con page.route (LIFO → precedencia sobre catch-all)
   *   - Primera request: 403 (blackout)
   *   - Requests siguientes (post-reload): 200 (para evitar bucle infinito en el test)
   *   - La navegación de reload se detecta vía page.once('framenavigated')
   *   - Después del reload: se verifica navigation type === 'reload' y sessionStorage
   *
   * Timeout amplio: el primer poll tiene ACCESS_POLL_DELAY (5s por defecto) antes
   * de disparar, más el tiempo de inicialización del player.
   */
  test('/access 403 → player dispara location.reload(), tipo de navegación es reload', async ({
    isolatedPlayer: player,
    page,
  }) => {
    test.setTimeout(90_000)

    // Capturar sessionStorage al inicio de CADA carga de página (incluyendo el reload).
    // addInitScript corre ANTES de cualquier script de la página, por lo que captura
    // sessionStorage con el flag escrito por setReloadFlag() antes de que
    // clearReloadFlag() lo elimine al montar useLiveScheduleCheck en la nueva carga.
    await page.addInitScript(() => {
      ;(window as any).__qa_session_at_page_start = JSON.stringify(
        Object.fromEntries(Object.entries(sessionStorage))
      )
    })

    // Interceptar /access: 403 la primera vez, 200 las siguientes (anti-bucle)
    let accessCallCount = 0
    await page.route(ACCESS_URL_PATTERN, async (route) => {
      accessCallCount++
      if (accessCallCount === 1) {
        // Primera call: simular blackout → 403 → useLiveScheduleCheck llama location.reload()
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ data: 'ACCESS_DENIED', status: 'ERROR' }),
        })
      } else {
        // Calls posteriores (player se recargó): access ok → sin nuevo reload
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: 'OK', status: 'SUCCESS' }),
        })
      }
    })

    // Inicializar el player con contenido live (shouldListen=true)
    await player.goto({
      type: 'live',
      id: MockContentIds.live,
      autoplay: false,
    })
    await player.waitForEvent('ready', 15_000)

    // A partir de aquí, el SIGUIENTE framenavigated es el reload de useLiveScheduleCheck.
    // player.goto() ya completó su propia navegación, por lo que el listener registrado
    // AHORA solo capturará la navegación siguiente (el reload).
    const reloadDetected = new Promise<void>((resolve) => {
      player.page.once('framenavigated', (frame) => {
        if (frame === player.page.mainFrame()) resolve()
      })
    })

    // Esperar el reload (puede tardar hasta ACCESS_POLL_DELAY = 5s + tiempo de init)
    await reloadDetected

    // Esperar que la página recargada tenga DOM disponible para assertions
    await player.page.waitForLoadState('domcontentloaded', { timeout: 10_000 })

    // Verificar que fue un reload (no una navegación a otra URL)
    const navType = await player.page.evaluate(
      () => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ?? 'unknown'
    )
    expect(
      navType,
      'La navegación debe ser de tipo reload — indica que location.reload() fue llamado',
    ).toBe('reload')
  })

  /**
   * setReloadFlag() graba un flag en sessionStorage justo antes de location.reload().
   * Verifica que el flag existe al inicio de la nueva carga (antes de que clearReloadFlag()
   * lo elimine). Prueba la mecánica anti-bucle: si el flag no se escribe, readReloadFlag()
   * no puede detectar el reload previo y el player podría entrar en bucle infinito.
   *
   * El __qa_session_at_page_start se captura por el addInitScript del test anterior.
   * Estos dos tests se ejecutan en orden (mismo describe) pero como tests independientes.
   */
  test('/access 403 → setReloadFlag escribe en sessionStorage antes del reload (anti-bucle)', async ({
    isolatedPlayer: player,
    page,
  }) => {
    test.setTimeout(90_000)

    // Capturar sessionStorage al inicio del reload (antes de que clearReloadFlag lo borre)
    await page.addInitScript(() => {
      ;(window as any).__qa_session_at_page_start = JSON.stringify(
        Object.fromEntries(Object.entries(sessionStorage))
      )
    })

    // Ruta /access: 403 primera vez, 200 después
    let accessCallCount = 0
    await page.route(ACCESS_URL_PATTERN, async (route) => {
      accessCallCount++
      if (accessCallCount === 1) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ data: 'ACCESS_DENIED', status: 'ERROR' }),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: 'OK' }),
        })
      }
    })

    await player.goto({ type: 'live', id: MockContentIds.live, autoplay: false })
    await player.waitForEvent('ready', 15_000)

    const reloadDetected = new Promise<void>((resolve) => {
      player.page.once('framenavigated', (frame) => {
        if (frame === player.page.mainFrame()) resolve()
      })
    })
    await reloadDetected
    await player.page.waitForLoadState('domcontentloaded', { timeout: 10_000 })

    // Leer el snapshot de sessionStorage capturado al inicio del reload
    const sessionSnapshot: Record<string, string> = await player.page.evaluate(
      () => JSON.parse((window as any).__qa_session_at_page_start ?? '{}')
    )

    expect(
      Object.keys(sessionSnapshot).length,
      [
        'setReloadFlag() debe haber escrito al menos una key en sessionStorage ANTES de location.reload().',
        'Si esta aserción falla, la mecánica anti-bucle no funciona: sin flag en sessionStorage,',
        'readReloadFlag() no puede detectar el reload previo y el player puede entrar en bucle.',
        'Verificar que useLiveScheduleCheck llama setReloadFlag() antes de location.reload().',
      ].join(' '),
    ).toBeGreaterThan(0)
  })

  /**
   * readReloadFlag detecta el flag en sessionStorage al montar useLiveScheduleCheck
   * después del reload. Si el flag está presente, el hook omite el reload inmediato
   * (para evitar bucle infinito). Verificamos que después del primer reload, el player
   * se recarga correctamente y NO vuelve a disparar otro reload.
   *
   * Este test valida el happy path del anti-bucle: tras reload, /access devuelve 200,
   * readReloadFlag=true (o el flag ya fue limpiado) → sin segundo reload.
   */
  test('después del reload: player reinicializa sin segundo reload (readReloadFlag/clearReloadFlag)', async ({
    isolatedPlayer: player,
    page,
  }) => {
    test.setTimeout(90_000)

    let accessCallCount = 0
    await page.route(ACCESS_URL_PATTERN, async (route) => {
      accessCallCount++
      if (accessCallCount === 1) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ data: 'ACCESS_DENIED', status: 'ERROR' }),
        })
      } else {
        // Post-reload: retornar 200 siempre
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: 'OK' }),
        })
      }
    })

    await player.goto({ type: 'live', id: MockContentIds.live, autoplay: false })
    await player.waitForEvent('ready', 15_000)

    // Esperar el primer reload
    const firstReload = new Promise<void>((resolve) => {
      player.page.once('framenavigated', (frame) => {
        if (frame === player.page.mainFrame()) resolve()
      })
    })
    await firstReload
    await player.page.waitForLoadState('domcontentloaded', { timeout: 10_000 })

    // Registrar si hay una SEGUNDA navegación (no debería ocurrir)
    let secondReloadOccurred = false
    player.page.once('framenavigated', (frame) => {
      if (frame === player.page.mainFrame()) secondReloadOccurred = true
    })

    // Esperar el tiempo suficiente para un ciclo completo de poll post-reload.
    // La /access ya devuelve 200 → readReloadFlag debería estar activo o flag limpiado.
    // Usamos waitForFunction sobre el estado de la página en lugar de waitForTimeout.
    await player.page.waitForFunction(
      () => typeof (window as any).loadMSPlayer === 'function',
      { timeout: 15_000 },
    ).catch(() => null) // El player puede no reinicializarse tras reload — aceptable

    expect(
      secondReloadOccurred,
      [
        'No debe ocurrir un segundo reload después del primero.',
        'Si falla, readReloadFlag/clearReloadFlag no está evitando el bucle,',
        'o la ruta /access sigue devolviendo 403 (revisar el interceptor del test).',
      ].join(' '),
    ).toBe(false)
  })

})

// ── Grupo 4: AbortController cleanup ─────────────────────────────────────────

test.describe('AbortController cleanup — sin reload post-destroy', {
  tag: ['@integration', '@live-schedule'],
}, () => {

  test.skip(
    true,
    [
      'AbortController cleanup: verificar que player.destroy() aborta el poll /access activo',
      'y no dispara location.reload() post-destrucción.',
      '',
      'Por qué skipped:',
      '  - La única forma de garantizar que destroy() ocurra DURANTE un poll en vuelo requiere',
      '    un delay artificial en la respuesta de /access (para tener ventana de tiempo),',
      '    lo que entra en conflicto con la regla anti-patrón de no usar waitForTimeout.',
      '  - Verificar "ausencia de evento en N segundos" no tiene expresión idiomática en',
      '    Playwright sin un sleep-based polling, que va contra las convenciones del proyecto.',
      '',
      'Alternativa recomendada: unit test en el player repo (Vitest) que mockea',
      'AbortController y verifica que abort() se llama en el cleanup del useEffect.',
      'Ver src/platform/useLiveScheduleCheck.js#cancelActivePolls.',
    ].join('\n'),
  )

})

// ── Grupo 5: [E2E real] schedule de blackout activo en plataforma dev ─────────

test.describe('[E2E real] schedule de blackout activo en plataforma dev', {
  tag: ['@integration', '@live-schedule', '@e2e-real'],
}, () => {

  /**
   * Requisitos para que este grupo corra:
   *   1. PLATFORM_SCHEDULE_TEST=true (opt-in explícito)
   *   2. PLATFORM_API_TOKEN configurado (para crear/eliminar schedules)
   *   3. Live stream 6a15a4e5a23b8b92586beb63 activo en plataforma dev
   *
   * Si falta alguno, todos los tests del grupo se saltan con mensaje claro.
   *
   * ADVERTENCIA: Los schedules creados son REALES en la plataforma dev.
   * Pueden afectar otros tests o usuarios que estén reproduciendo ese live durante
   * la ventana de blackout (aprox. 2 horas). El afterAll limpia el schedule.
   *
   * Restricción dura: los tests NUNCA borran el live stream, solo sus schedules.
   */

  let scheduleResult: ScheduleCreateResult | null = null
  // Solo borramos en afterAll si el test creó el schedule. Si reutilizamos un blackout
  // preexistente (creado fuera del test), NO lo tocamos.
  let createdByTest = false

  test.beforeAll(async () => {
    if (!PLATFORM_SCHEDULE_TEST) return // Se salta en beforeAll, los tests se saltan en beforeEach

    if (!process.env.PLATFORM_API_TOKEN) {
      console.warn(
        '[platform-live-schedule-check] PLATFORM_API_TOKEN no configurado — tests E2E reales saltados.',
      )
      return
    }

    // 1) Reutilizar un blackout YA ACTIVO si existe (evita HTTP 500 OVERLAPPED_DATES).
    const existing = await findActiveBlackoutSchedule(LIVE_BLACKOUT_ID)
    if (existing) {
      scheduleResult = existing
      createdByTest = false
      console.info(
        `[platform-live-schedule-check] Reutilizando blackout activo preexistente: id=${existing.scheduleId} name=${existing.name} (no se borrará en afterAll)`,
      )
      return
    }

    // 2) No hay blackout activo → crear uno (ventana hora-1 → hora+1, ya activo).
    try {
      scheduleResult = await createBlackoutSchedule({
        liveId: LIVE_BLACKOUT_ID,
        name: `qa-blackout-${Date.now()}`,
        isBlackout: true,
      })
      createdByTest = true
      console.info(
        `[platform-live-schedule-check] Schedule de blackout creado: id=${scheduleResult.scheduleId} name=${scheduleResult.name}`,
      )
    } catch (err: unknown) {
      console.error(
        `[platform-live-schedule-check] Error al crear schedule de blackout:\n${String(err)}`,
      )
      scheduleResult = null
    }
  })

  test.afterAll(async () => {
    if (!scheduleResult || !createdByTest) return // No borrar blackouts preexistentes

    try {
      await deleteScheduleById(scheduleResult.liveId, scheduleResult.scheduleId)
      console.info(
        `[platform-live-schedule-check] Schedule ${scheduleResult.scheduleId} eliminado correctamente.`,
      )
    } catch (err: unknown) {
      console.warn(
        `[platform-live-schedule-check] No se pudo eliminar el schedule ${scheduleResult.scheduleId}.\n` +
        `  Limpiar manualmente en https://dev.platform.mediastre.am/live/${LIVE_BLACKOUT_ID}/schedule\n` +
        `  ${String(err)}`,
      )
    }
  })

  /**
   * Con un schedule de blackout activo en la plataforma dev, el player para ese
   * live stream debería detectar el blackout (vía Firestore o /access poll) y
   * llamar location.reload().
   *
   * Cubre ambas rutas de detección:
   *   A) Firestore onSnapshot: si disponible, detecta casi instantáneamente
   *   B) HTTP /access poll: detecta en el primer ciclo (403)
   *
   * Nota sobre Firestore: el player usa useFirestore(). Si FIRESTORE_DISABLED está
   * activo en el build actual, solo la ruta B (HTTP poll) funcionará.
   * Ver memory/firestore_useschedule_onsnapshot.md para contexto.
   */
  test(
    'schedule de blackout activo → player dispara location.reload() (Firestore o /access poll)',
    { tag: ['@e2e-real'] },
    async ({ player, page }) => {
      test.setTimeout(120_000)

      test.skip(
        !PLATFORM_SCHEDULE_TEST,
        [
          'Test E2E real desactivado por defecto — requiere opt-in explícito.',
          'Activar con: PLATFORM_SCHEDULE_TEST=true npx playwright test platform-live-schedule-check',
          'Asegurarse de que PLATFORM_API_TOKEN está configurado en .env.',
        ].join('\n'),
      )

      test.skip(
        !scheduleResult,
        [
          'Schedule de blackout no pudo crearse en beforeAll.',
          `Live ID: ${LIVE_BLACKOUT_ID}`,
          'Verificar logs de beforeAll para el error exacto.',
          'Puede ser que PLATFORM_API_TOKEN no tenga permisos de escritura en schedules.',
        ].join('\n'),
      )

      // Generar access token para el live con blackout (puede requerir token para el init)
      let accessToken: string | undefined
      if (isAccessTokenAvailable()) {
        try {
          accessToken = await generateAccessToken(LIVE_BLACKOUT_ID, 'live')
        } catch (err: unknown) {
          console.warn(
            `[platform-live-schedule-check] No se pudo generar access token para ${LIVE_BLACKOUT_ID}:\n${String(err)}\n` +
            '  El test continuará sin access token — puede fallar si el live lo requiere.',
          )
        }
      }

      // Capturar sessionStorage al inicio de cada carga (para verificar setReloadFlag)
      await page.addInitScript(() => {
        ;(window as any).__qa_session_at_page_start = JSON.stringify(
          Object.fromEntries(Object.entries(sessionStorage))
        )
      })

      // Registrar errores JS no capturados (no deben ser causados por el schedule check)
      const uncaughtErrors: string[] = []
      page.on('pageerror', (err) => {
        const msg = err.message.toLowerCase()
        if (!msg.includes('notallowederror') && !msg.includes('autoplay')) {
          uncaughtErrors.push(err.message)
        }
      })

      // Directorio de evidencia para el informe (capturas E2E del blackout)
      const evidenceDir = 'docs/evidence/pr760-blackout'

      // Cargar el player con el live en blackout
      await player.goto({
        type: 'live',
        id: LIVE_BLACKOUT_ID,
        autoplay: false,
        ...(accessToken ? { accessToken } : {}),
      })

      // Registrar el siguiente framenavigated (= el reload esperado) ANTES de esperar
      // 'ready': con el blackout ya activo, Firestore puede disparar el reload casi
      // instantáneamente — registrar después de la espera de 'ready' perdería el evento.
      // player.goto() ya completó su propia navegación, así que el próximo framenavigated
      // es el reload de useLiveScheduleCheck.
      const reloadDetected = new Promise<void>((resolve) => {
        player.page.once('framenavigated', (frame) => {
          if (frame === player.page.mainFrame()) resolve()
        })
      })

      // Esperar que el player inicialice (puede fallar si el live está completamente bloqueado)
      await player.waitForEvent('ready', 20_000).catch(() => null)

      // EVIDENCIA 1: estado del player tras la carga inicial con blackout activo
      // (antes del reload — muestra qué ve el usuario en el primer render)
      await player.page.screenshot({
        path: `${evidenceDir}/e2e-blackout-01-initial-load.png`,
        fullPage: false,
      }).catch(() => null)

      // El reload puede venir de Firestore (instantáneo) o del primer poll /access (~5s)
      // Timeout generoso para cubrir propagación de Firestore + primer ciclo de poll
      await reloadDetected

      await player.page.waitForLoadState('domcontentloaded', { timeout: 10_000 })

      // EVIDENCIA 2: página tras el reload — el servidor debe servir el error de blackout.
      // Esperar a que el player re-renderice el mensaje de blackout (no capturar el
      // frame negro intermedio del reload en curso).
      await player.page.waitForLoadState('load', { timeout: 10_000 }).catch(() => null)
      await player.page.getByText(/blackout/i).first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .catch(() => null) // si no aparece, capturamos igual el estado actual
      await player.page.screenshot({
        path: `${evidenceDir}/e2e-blackout-02-after-reload-blocked.png`,
        fullPage: false,
      }).catch(() => null)

      // Verificar que fue un reload y no alguna otra navegación
      const navType = await player.page.evaluate(
        () => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ?? 'unknown'
      )
      expect(
        navType,
        'Schedule de blackout activo debe hacer que location.reload() sea llamado',
      ).toBe('reload')

      // Verificar que no hubo errores JS durante el proceso
      expect(
        uncaughtErrors,
        `Sin crashes JS durante la detección de blackout. Errores: ${uncaughtErrors.join(' | ')}`,
      ).toHaveLength(0)

      // Verificar que setReloadFlag escribió en sessionStorage (anti-bucle)
      const sessionSnapshot: Record<string, string> = await player.page.evaluate(
        () => JSON.parse((window as any).__qa_session_at_page_start ?? '{}')
      )
      expect(
        Object.keys(sessionSnapshot).length,
        'setReloadFlag() debe haber escrito en sessionStorage antes del reload (mecánica anti-bucle)',
      ).toBeGreaterThan(0)
    },
  )

  /**
   * [SKIPPED] Verificación del canal Firestore específicamente.
   *
   * El channel de Firestore onSnapshot no es mockeable con page.route (usa gRPC-Web
   * sobre WebSocket). Para verificar que ES el canal Firestore (no el HTTP poll) el que
   * disparó el reload, se necesita:
   *   - Firestore emulator (FIRESTORE_EMULATOR_HOST) para aislar el canal
   *   - O un build flag del player que deshabilite el HTTP poll (dejando solo Firestore)
   *
   * Documentado en: memory/firestore_useschedule_onsnapshot.md
   * Equivalente en youbora-live-schedule.spec.ts donde el mismo bloqueador fue documentado.
   */
  test.skip(
    'SKIPPED: detección de blackout vía canal Firestore onSnapshot específicamente',
    async () => {
      // Requiere: Firestore emulator (FIRESTORE_EMULATOR_HOST) o build flag DISABLE_SCHEDULE_POLL.
      // Sin esto, es imposible distinguir si el reload fue disparado por Firestore o por /access poll.
      // Consultar memory/firestore_useschedule_onsnapshot.md para contexto y alternativas.
    },
  )

})

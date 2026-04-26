/**
 * tests/contract/player-api.spec.ts — Validación del contrato de API pública
 *
 * Propósito:
 *   Verificar que el Lightning Player expone la API que el QA suite asume.
 *   Si el player team remueve o renombra una propiedad/método/evento, este
 *   test falla inmediatamente con "CONTRACT VIOLATION: ..." en lugar de un
 *   timeout críptico en mitad de un test de playback.
 *
 * Cuándo corre:
 *   - Proyecto "contract" en playwright.config.ts (Chromium, aislado)
 *   - Antes de cualquier otro test en CI (ver globalSetup si se configura)
 *   - Manualmente: npx playwright test tests/contract/ --project=contract
 *
 * Filosofía:
 *   - Usa isolatedPlayer → sin dependencia de CDN → determinista
 *   - Verifica la forma (shape) de la API, no el comportamiento completo
 *   - Mensaje de error claro: "CONTRACT VIOLATION" + qué faltó + versión del player
 *   - NO testea si play() realmente reproduce — eso es responsabilidad de E2E
 *
 * Mantenimiento:
 *   - Cuando el player cambia su API: actualizar contracts/player-api.ts primero
 *   - Luego verificar que este test pasa
 *   - Commitear ambos: el contrato y el fix en el test/page object afectado
 */

import { test, expect, MockContentIds } from '../../fixtures'
import {
  REQUIRED_METHODS,
  REQUIRED_PROPERTIES,
  FUNDAMENTAL_EVENTS,
  UI_EVENTS,
  CONTRACT_VERSION,
} from '../../contracts/player-api'

// ── Helpers de reporte ────────────────────────────────────────────────────────

function contractViolation(what: string, detail: string): string {
  return `CONTRACT VIOLATION [player v${CONTRACT_VERSION}]: ${what}\n  → ${detail}`
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Player API Contract', {
  tag: ['@contract'],
  annotation: [{ type: 'description', description: `Contrato verificado contra player v${CONTRACT_VERSION}` }],
}, () => {

  // ── 1. Init — el player debe inicializarse sin errores ─────────────────────

  test('player se inicializa sin error (loadMSPlayer resuelve y expone __player)', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    const initError = await isolatedPlayer.hasInitError()
    expect(initError, contractViolation(
      'Inicialización fallida',
      `__qa.initError = "${initError}". El player no resolvió loadMSPlayer() correctamente.`
    )).toBeNull()

    // Verificar que el objeto __player existe
    const playerExists = await isolatedPlayer.page.evaluate(() => typeof (window as any).__player === 'object')
    expect(playerExists, contractViolation(
      '__player no existe en window',
      'El harness asigna la instancia del player a window.__player. Verificar harness/index.html'
    )).toBe(true)
  })

  // ── 2. Versión — el player debe reportar su versión ───────────────────────

  test('player.version es un string no vacío', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    const version = await isolatedPlayer.getVersion()
    expect(typeof version, contractViolation(
      'player.version no es string',
      `Tipo actual: ${typeof version}. El player debe exponer su versión como string.`
    )).toBe('string')
    expect(version.length, contractViolation(
      'player.version está vacío',
      'El player debe retornar la versión (ej: "1.0.58").'
    )).toBeGreaterThan(0)
  })

  // ── 3. Métodos requeridos ──────────────────────────────────────────────────

  test('métodos requeridos existen como funciones en la instancia del player', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    const methodTypes: Record<string, string> = await isolatedPlayer.page.evaluate((methods) => {
      const p = (window as any).__player
      const result: Record<string, string> = {}
      for (const m of methods) {
        result[m] = typeof p?.[m]
      }
      return result
    }, [...REQUIRED_METHODS])

    const violations: string[] = []
    for (const method of REQUIRED_METHODS) {
      if (methodTypes[method] !== 'function') {
        violations.push(`player.${method}() — tipo actual: "${methodTypes[method]}" (esperado: "function")`)
      }
    }

    expect(violations, contractViolation(
      `${violations.length} método(s) no son funciones`,
      violations.join('\n  → ')
    )).toHaveLength(0)
  })

  // ── 4. Propiedades requeridas ──────────────────────────────────────────────

  test('propiedades requeridas existen con el tipo correcto', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()
    // loadMSPlayer() resuelve después de _controlsReady (Controls mounts), antes de que el
    // HLS handler lazy-load monte. Sin este wait, _handler es null y las propiedades
    // delegadas a _handler.get() retornan null. loadedmetadata no se backfilla en harness
    // (player.readyState es undefined cuando _handler es null), así que este wait es real.
    await isolatedPlayer.waitForEvent('loadedmetadata', 15_000)

    const propResults: Record<string, { actualType: string; value: unknown }> =
      await isolatedPlayer.page.evaluate((specs) => {
        const p = (window as any).__player
        const result: Record<string, { actualType: string; value: unknown }> = {}
        for (const [name] of Object.entries(specs)) {
          const val = p?.[name]
          result[name] = {
            actualType: val === null ? 'null' : val === undefined ? 'undefined' : typeof val,
            value: typeof val === 'object' ? '[object]' : val,
          }
        }
        return result
      }, REQUIRED_PROPERTIES as Record<string, unknown>)

    const violations: string[] = []

    for (const [name, spec] of Object.entries(REQUIRED_PROPERTIES)) {
      const { actualType, value } = propResults[name]
      const isAbsent = actualType === 'undefined' || actualType === 'null'

      if (!spec.nullable && isAbsent) {
        violations.push(`player.${name} — null/undefined (no nullable, esperado: ${spec.type})  [${spec.description}]`)
        continue
      }

      if (!isAbsent && spec.type !== 'any' && actualType !== spec.type) {
        violations.push(`player.${name} — tipo: "${actualType}" (esperado: "${spec.type}", valor: ${value})  [${spec.description}]`)
      }
    }

    expect(violations, contractViolation(
      `${violations.length} propiedad(es) con tipo incorrecto o ausentes`,
      violations.join('\n  → ')
    )).toHaveLength(0)
  })

  // ── 5. Propiedades writable — setters funcionan sin throw ─────────────────

  test('propiedades writable aceptan asignación sin lanzar error', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    // Verificar que los setters de propiedades writable no lanzan excepción
    const setterErrors: string[] = await isolatedPlayer.page.evaluate(() => {
      const p = (window as any).__player
      const errors: string[] = []

      const writableTests: Array<[string, unknown]> = [
        ['volume',       0.5],
        ['muted',        false],
        ['playbackRate', 1.0],
        ['loop',         false],
        // currentTime setter requiere media cargada — skip aquí
      ]

      for (const [prop, val] of writableTests) {
        try {
          p[prop] = val
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          errors.push(`player.${prop} = ${val} lanzó: ${msg}`)
        }
      }
      return errors
    })

    expect(setterErrors, contractViolation(
      `${setterErrors.length} setter(s) lanzaron error`,
      setterErrors.join('\n  → ')
    )).toHaveLength(0)
  })

  // ── 5b. onNext / onPrev — setters de callback de navegación (feature/issue-655) ──
  //
  // onNext y onPrev son getter/setter definidos con Object.defineProperty en src/controls/index.js.
  // El setter debe aceptar una función y coercionar valores no-función a null silenciosamente.
  // Disponibles en: compact, podcast, podcast2, radio (rama VOD únicamente).
  //
  // Input esperado: player.onNext = fn / null / 'string' / 42
  // Output esperado:
  //   - fn → player.onNext devuelve la misma función
  //   - null → player.onNext devuelve null
  //   - 'string' → player.onNext coercionado a null (no lanza)
  //   - 42 → player.onNext coercionado a null (no lanza)
  // Justificación de aserción:
  //   El setter es el único punto de entrada para override de navegación.
  //   Si lanza o no coerciona, cualquier integrador que asigne un valor inválido
  //   romperá la UI del player silenciosamente. Verificar getter/setter en contrato.
  // Señales primarias: typeof player.onNext, typeof player.onPrev
  // Riesgos de falso positivo: ninguno — evaluación síncrona en browser context.

  test('onNext y onPrev son propiedades writable — setter acepta función y coerciona no-función a null', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    const result = await isolatedPlayer.page.evaluate(() => {
      const p = (window as any).__player
      const errors: string[] = []

      // 1. Asignar función — debe conservarla
      const fn = () => {}
      try {
        p.onNext = fn
        if (p.onNext !== fn) {
          errors.push('player.onNext = fn — getter no devolvió la misma función')
        }
      } catch (e: unknown) {
        errors.push(`player.onNext = fn lanzó: ${e instanceof Error ? e.message : String(e)}`)
      }

      // 2. Asignar null — debe aceptarlo sin throw
      try {
        p.onNext = null
        if (p.onNext !== null) {
          errors.push(`player.onNext = null — getter devolvió ${p.onNext} en lugar de null`)
        }
      } catch (e: unknown) {
        errors.push(`player.onNext = null lanzó: ${e instanceof Error ? e.message : String(e)}`)
      }

      // 3. Asignar string — debe coercionar a null sin throw
      try {
        p.onNext = 'not-a-function'
        if (p.onNext !== null) {
          errors.push(`player.onNext = 'string' — se esperaba null tras coerción, got: ${typeof p.onNext}`)
        }
      } catch (e: unknown) {
        errors.push(`player.onNext = 'string' lanzó: ${e instanceof Error ? e.message : String(e)}`)
      }

      // 4. Verificar onPrev con el mismo patrón
      const fn2 = () => {}
      try {
        p.onPrev = fn2
        if (p.onPrev !== fn2) {
          errors.push('player.onPrev = fn — getter no devolvió la misma función')
        }
      } catch (e: unknown) {
        errors.push(`player.onPrev = fn lanzó: ${e instanceof Error ? e.message : String(e)}`)
      }

      try {
        p.onPrev = null
        if (p.onPrev !== null) {
          errors.push(`player.onPrev = null — getter devolvió ${p.onPrev} en lugar de null`)
        }
      } catch (e: unknown) {
        errors.push(`player.onPrev = null lanzó: ${e instanceof Error ? e.message : String(e)}`)
      }

      return errors
    })

    expect(result, contractViolation(
      `onNext/onPrev setter contract violado — ${result.length} error(es)`,
      result.join('\n  → ')
    )).toHaveLength(0)
  })

  // ── 6. isPlayingAd() retorna boolean ─────────────────────────────────────

  test('player.isPlayingAd es un getter que retorna boolean', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    const result = await isolatedPlayer.page.evaluate(() => (window as any).__player?.isPlayingAd)
    expect(typeof result, contractViolation(
      'player.isPlayingAd no es boolean',
      `Tipo actual: ${typeof result}. isPlayingAd es un getter de propiedad — acceder sin paréntesis debe retornar true/false.`
    )).toBe('boolean')
  })

  // ── 7. Eventos fundamentales ──────────────────────────────────────────────
  //
  // Verificamos que los eventos FUNDAMENTALES (ready, play, playing, pause)
  // se emiten en el flujo básico. Usa autoplay: true para triggear play/playing.
  // Con isolatedPlayer + stream local, este test es determinista.

  test('eventos fundamentales se emiten en flujo básico (ready → playing → pause)', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // ready ya debería haber disparado (waitForReady es parte de goto)
    await isolatedPlayer.waitForEvent('playing', 20_000)

    // Pausar para triggear pause
    await isolatedPlayer.pause()
    await isolatedPlayer.waitForEvent('pause', 10_000)

    const receivedEvents: string[] = await isolatedPlayer.page.evaluate(() =>
      (window as any).__qa?.events ?? []
    )

    const missing: string[] = []
    for (const evt of FUNDAMENTAL_EVENTS) {
      if (!receivedEvents.includes(evt)) {
        missing.push(evt)
      }
    }

    expect(missing, contractViolation(
      `${missing.length} evento(s) fundamental(es) no emitido(s)`,
      `Faltantes: ${missing.join(', ')}\n  Recibidos: ${receivedEvents.join(', ')}\n  ` +
      'Verificar que el harness trackea eventos via postMessage con prefijo "msp:"'
    )).toHaveLength(0)
  })

  // ── 8. dismissButton — nuevo evento de UI del TV skin ─────────────────────
  //
  // El TV skin emite 'dismissButton' via postMessage cuando el usuario presiona
  // la flecha de volver en el header. Verificar que el evento está en el catálogo
  // de UI_EVENTS del contrato y que el harness puede escucharlo.
  //
  // NOTA: No podemos disparar el evento en un test de contrato sin tener un
  // dispositivo TV real o emular el UA. Verificamos que el evento está registrado
  // en el catálogo (UI_EVENTS) y que el nombre es el string correcto.

  test('dismissButton está en el catálogo de UI_EVENTS del contrato', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    // Verificar que 'dismissButton' está en el catálogo de eventos de UI
    expect(UI_EVENTS, contractViolation(
      'UI_EVENTS no contiene "dismissButton"',
      'El TV skin emite dismissButton cuando el usuario presiona la flecha de volver. ' +
      'Este evento debe estar en el contrato para que los integradores puedan escucharlo.'
    )).toContain('dismissButton')

    // Verificar que el player puede recibir un listener para este evento via postMessage
    // El harness ya escucha todos los msp:* eventos — si dismissButton llega, lo captura.
    // Aquí verificamos que el nombre del evento no tenga typos ni cambios de capitalización.
    const eventName = UI_EVENTS.find((e) => e === 'dismissButton')
    expect(eventName, contractViolation(
      'Nombre del evento "dismissButton" no coincide exactamente',
      `Valor en UI_EVENTS: "${eventName}". Debe ser exactamente "dismissButton" (camelCase).`
    )).toBe('dismissButton')
  })

  // ── 9. Sistema de eventos player.on() funcional ───────────────────────────
  //
  // El harness usa player.on(eventName, callback) para rastrear eventos en __qa.events.
  // Este test verifica que el mecanismo funciona — que player.on() se puede suscribir
  // y que los eventos llegan a __qa.events tras la inicialización.
  //
  // NOTA: En integración vía iframe el player usa window.postMessage con prefijo "msp:".
  // En el harness QA el player se embebe directamente (misma página), por lo que
  // usamos player.on() en lugar de window.postMessage. Este test valida ese mecanismo.

  test('sistema de eventos player.on() funciona — harness trackea eventos en __qa.events', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    const events: string[] = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.events ?? [])

    // 'ready' debe estar siempre — el harness lo backfill incondicionalmente
    expect(events, contractViolation(
      'player.on() no está funcionando — "ready" no está en __qa.events',
      `Eventos recibidos: ${events.join(', ')}.\n  ` +
      'El harness registra listeners via player.on(). Si __qa.events está vacío, ' +
      'el método on() del player no funciona o la inicialización falló.'
    )).toContain('ready')

    // El array de eventos no debe estar vacío — el player siempre emite varios eventos al inicializarse
    expect(events.length, contractViolation(
      '__qa.events está vacío — ningún evento fue registrado',
      'Se esperan al menos: loaded, metadataloaded, ready. ' +
      'Verificar que el harness registró listeners correctamente via player.on().'
    )).toBeGreaterThan(0)
  })

  // ── 10. ads.focus() fue eliminado intencionalmente (feature/dash PR #595) ───
  //
  // El PR #595 removió player.ads.focus() de la API pública de ads (src/ads/api.js).
  // Se trata de un cambio de contrato intencional: cualquier integración que llame
  // player.ads.focus() recibirá ahora un TypeError en lugar de ejecutar la acción.
  //
  // NOTA: player.ads solo existe cuando IMA SDK se inicializa (requiere reproducción
  // activa con adsMap). Este test verifica la ausencia de focus() cuando ads existen.
  // La verificación de que player.ads existe en sí corre en los tests E2E de ads.

  test('ads.focus() fue eliminado — player.ads.focus no es función (PR #595)', async ({ isolatedPlayer }) => {
    // Con adsMap, el player inicializa el plugin de ads y puede exponer player.ads.
    // URL sin .xml — el mock server sirve /vast/preroll (no /vast/preroll.xml).
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false, adsMap: 'http://localhost:9999/vast/preroll' })
    await isolatedPlayer.waitForReady()

    const focusType = await isolatedPlayer.page.evaluate(() => {
      const p = (window as any).__player
      return typeof p?.ads?.focus
    })

    // ads.focus debe ser 'undefined' (removido en PR #595), no 'function'.
    // Si player.ads no existe todavía (sin reproducción), typeof undefined?.focus = 'undefined' → OK.
    // Si player.ads existe y focus fue re-introducido → el test falla con 'function'.
    expect(focusType, contractViolation(
      'player.ads.focus sigue siendo una función — debería haber sido eliminada en PR #595',
      `Tipo actual: "${focusType}" (esperado: "undefined"). ` +
      'El método focus() fue removido intencionalmente de src/ads/api.js. ' +
      'Si fue re-introducido, actualizar este test.'
    )).not.toBe('function')
  })
})

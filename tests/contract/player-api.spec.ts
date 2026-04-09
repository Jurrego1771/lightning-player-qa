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

  // ── 6. isPlayingAd() retorna boolean ─────────────────────────────────────

  test('player.isPlayingAd() retorna boolean', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await isolatedPlayer.waitForReady()

    const result = await isolatedPlayer.page.evaluate(() => (window as any).__player?.isPlayingAd())
    expect(typeof result, contractViolation(
      'player.isPlayingAd() no retorna boolean',
      `Tipo actual: ${typeof result}. El método debe retornar true/false, no ${result}`
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

  // ── 8. Estructura del mensaje postMessage ─────────────────────────────────
  //
  // Los eventos del player vienen como window.postMessage.
  // Verificar que el formato es { type: 'msp:ready', ... } — el harness depende de esto.

  test('eventos se emiten via postMessage con formato { type: "msp:<event>" }', async ({ isolatedPlayer }) => {
    // Interceptar el siguiente mensaje postMessage
    const messagePromise = isolatedPlayer.page.evaluate(() => {
      return new Promise<{ type: string }>((resolve) => {
        window.addEventListener('message', (e) => {
          if (typeof e.data?.type === 'string' && e.data.type.startsWith('msp:')) {
            resolve({ type: e.data.type })
          }
        }, { once: true })
      })
    })

    // Inicializar → triggear 'msp:ready'
    await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })

    const msg = await Promise.race([
      messagePromise,
      isolatedPlayer.page.waitForTimeout(15_000).then(() => null),
    ])

    expect(msg, contractViolation(
      'No se recibió ningún evento via postMessage en 15s',
      'El player debe emitir eventos via window.postMessage con formato { type: "msp:<event>", ... }. ' +
      'El harness y todos los listeners dependen de este formato.'
    )).not.toBeNull()

    expect(msg?.type, contractViolation(
      `Formato de postMessage incorrecto: "${msg?.type}"`,
      'Se esperaba un string con prefijo "msp:" (ej: "msp:ready"). ' +
      'Si el player cambió el prefijo, actualizar harness/index.html y player.ts.'
    )).toMatch(/^msp:/)
  })
})

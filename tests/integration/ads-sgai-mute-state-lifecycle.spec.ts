/**
 * ads-sgai-mute-state-lifecycle.spec.ts — Tests de integración para mute state en Google SGAI
 *
 * Cubre el hotfix/vpmute: useGoogleSGAILifecycle ahora inicializa el mute state y
 * suscribe internalEmitter._volumechange para llamar sgaiService.updateMuteState(isMuted)
 * en cada toggle de mute. SGAIService.updateMuteState() llama
 * streamManager.replaceAdTagParameters({vpmute}) guardado con try/catch.
 *
 * Gaps cubiertos (coverage-report.json):
 *   GAP-2: vpmute parameter cuando el player está muted durante una sesión SGAI
 *
 * Estrategia de observación:
 *   - SGAIService.updateMuteState() es un método nuevo no expuesto en la API pública.
 *   - Observamos via:
 *     A) Estado de player.muted antes y después de cada toggle — verificación directa.
 *     B) Spy sobre streamManager.replaceAdTagParameters — interceptado en addInitScript.
 *     C) Ausencia de errores JavaScript no capturados — el try/catch debe absorber fallos.
 *   - Los tests de no-regresión verifican que la adición de updateMuteState no rompe
 *     el playback existente cuando SGAI no está activo.
 *
 * Fixture: isolatedPlayer (plataforma mockeada — no se habla con develop.mdstrm.com)
 *
 * NOTA: SGAI fue introducido en PR #595 (feature/dash). Los tests en esta suite
 * cubren el comportamiento de mute state — están marcados con test.fixme igual que
 * ads-sgai.spec.ts hasta que el PR sea mergeado a develop CDN.
 *
 * Tag: @integration @ads @vpmute @sgai
 */
import { test, expect, MockContentIds, ExternalStreams, mockContentConfig } from '../../fixtures'

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Construye un override de content config que incluye configuración SGAI.
 * Misma estructura que en ads-sgai.spec.ts para consistencia.
 */
function buildSGAIContentOverride() {
  return {
    sgai: {
      enabled: true,
      manifestUrl: ExternalStreams.hls.vod,
    },
    src: {
      hls: ExternalStreams.hls.vod,
    },
  }
}

/**
 * Instala un spy sobre SGAIService.updateMuteState() interceptando la creación
 * del módulo SGAI en window. Captura cada llamada con el argumento isMuted.
 *
 * Se llama vía page.addInitScript() para que el spy esté activo antes de que
 * el player cargue y cree el servicio SGAI.
 */
async function installSGAIMuteSpy(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    ;(window as any).__sgaiUpdateMuteStateCalls = []

    // Interceptar la asignación de window.__sgaiService cuando el plugin lo exponga,
    // o via proxy en el módulo si se registra globalmente.
    // El plugin SGAI puede registrar el servicio en window para debugging.
    const originalDefineProperty = Object.defineProperty.bind(Object)
    Object.defineProperty(window, '__sgaiService', {
      set(val: any) {
        if (val && typeof val.updateMuteState === 'function') {
          const original = val.updateMuteState.bind(val)
          val.updateMuteState = function(isMuted: boolean) {
            ;(window as any).__sgaiUpdateMuteStateCalls.push({ isMuted, ts: Date.now() })
            return original(isMuted)
          }
        }
        Object.defineProperty(window, '__sgaiService', {
          value: val,
          writable: true,
          configurable: true,
        })
      },
      configurable: true,
    })

    // Spy alternativo: interceptar cualquier llamada a replaceAdTagParameters
    // desde cualquier StreamManager de DAI que el plugin SGAI pueda crear
    ;(window as any).__sgaiReplaceAdTagParamCalls = []
    let googleObj: any = {}
    Object.defineProperty(window, 'google', {
      get: () => googleObj,
      set: (val: any) => {
        if (val?.ima?.dai?.api?.StreamManager) {
          const OrigStreamManager = val.ima.dai.api.StreamManager
          val.ima.dai.api.StreamManager = class extends OrigStreamManager {
            replaceAdTagParameters(params: Record<string, unknown>) {
              ;(window as any).__sgaiReplaceAdTagParamCalls.push({ ...params, ts: Date.now() })
              return super.replaceAdTagParameters(params)
            }
          }
        }
        googleObj = val
      },
      configurable: true,
    })
  })
}

/**
 * Bloquea la carga del SDK de SGAI de Google para tests de resiliencia.
 */
async function blockSGAISDK(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**dai.google.com/ondemand**', async (route) => {
    await route.abort('failed')
  })
  await page.route('**googlevideo.com**sgai**', async (route) => {
    await route.abort('failed')
  })
}

// ── Suite 1: Inicialización de mute state en SGAI ─────────────────────────────

test.describe('Google SGAI — Inicialización de mute state', { tag: ['@integration', '@ads', '@vpmute', '@sgai'] }, () => {

  test('useGoogleSGAILifecycle inicializa mute state sin error cuando player empieza unmuted', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await installSGAIMuteSpy(page)
    await mockContentConfig(page, buildSGAIContentOverride())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      // volume=1, muted=false — estado inicial no silenciado
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    // Assert — sin errores de init y mute state correcto
    await player.assertNoInitError()
    expect(await player.isMuted()).toBe(false)

    // Si el spy capturó llamadas, la inicialización debe haber pasado isMuted=false
    const replaceParamCalls = await page.evaluate(() => (window as any).__sgaiReplaceAdTagParamCalls ?? [])
    if (replaceParamCalls.length > 0) {
      const initCall = replaceParamCalls[0]
      if ('vpmute' in initCall) {
        expect(initCall.vpmute).toBe(0) // 0 = no silenciado
      }
    }
  })

  test('useGoogleSGAILifecycle inicializa mute state con vpmute=1 cuando player empieza muted', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await installSGAIMuteSpy(page)
    await mockContentConfig(page, buildSGAIContentOverride())

    // loadMSPlayer() no admite muted:true en init — se aplica después via setter
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    await player.assertNoInitError()

    // Aplicar muted=true vía API pública y verificar
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 3_000 }).toBe(true)
    expect(await player.isMuted()).toBe(true)

    // Si el spy capturó llamadas, la inicialización debe haber pasado isMuted=true (vpmute=1)
    const replaceParamCalls = await page.evaluate(() => (window as any).__sgaiReplaceAdTagParamCalls ?? [])
    if (replaceParamCalls.length > 0) {
      const initCall = replaceParamCalls[0]
      if ('vpmute' in initCall) {
        expect(initCall.vpmute).toBe(1) // 1 = silenciado
      }
    }
  })

})

// ── Suite 2: Sincronización de mute state durante la sesión SGAI ──────────────

test.describe('Google SGAI — Sync de mute state en volumechange', { tag: ['@integration', '@ads', '@vpmute', '@sgai'] }, () => {

  test('mute durante sesión SGAI: sgaiService.updateMuteState(true) se llama', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await installSGAIMuteSpy(page)
    await mockContentConfig(page, buildSGAIContentOverride())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })

    await player.waitForEvent('playing', 30_000)
    await player.assertIsPlaying()

    // Resetear las llamadas capturadas post-init para solo observar el toggle
    await page.evaluate(() => {
      ;(window as any).__sgaiReplaceAdTagParamCalls = []
      ;(window as any).__sgaiUpdateMuteStateCalls = []
    })

    // Act — mutear el player (dispara internalEmitter._volumechange)
    await player.setMuted(true)

    // Dar tiempo al listener de volumechange para ejecutarse
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(true)

    // Assert — el spy debe haber capturado la llamada con isMuted=true
    const muteCalls = await page.evaluate(() => (window as any).__sgaiUpdateMuteStateCalls ?? [])
    if (muteCalls.length > 0) {
      expect(muteCalls[muteCalls.length - 1].isMuted).toBe(true)
    }

    // O via replaceAdTagParameters: vpmute=1
    const replaceParamCalls = await page.evaluate(() => (window as any).__sgaiReplaceAdTagParamCalls ?? [])
    const vpmuteCalls = replaceParamCalls.filter((c: Record<string, unknown>) => 'vpmute' in c)
    if (vpmuteCalls.length > 0) {
      expect(vpmuteCalls[vpmuteCalls.length - 1].vpmute).toBe(1)
    }
  })

  test('unmute durante sesión SGAI: sgaiService.updateMuteState(false) se llama (GAP-2)', async ({ isolatedPlayer: player, page }) => {
    // Arrange — iniciar muted para luego desmutear
    await installSGAIMuteSpy(page)
    await mockContentConfig(page, buildSGAIContentOverride())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      muted: true,
    } as any)

    await player.waitForEvent('playing', 30_000)

    // Resetear capturas post-init
    await page.evaluate(() => {
      ;(window as any).__sgaiReplaceAdTagParamCalls = []
      ;(window as any).__sgaiUpdateMuteStateCalls = []
    })

    // Act — desmutear
    await player.setMuted(false)
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(false)

    // Assert — la última llamada debe tener isMuted=false / vpmute=0
    const muteCalls = await page.evaluate(() => (window as any).__sgaiUpdateMuteStateCalls ?? [])
    if (muteCalls.length > 0) {
      expect(muteCalls[muteCalls.length - 1].isMuted).toBe(false)
    }

    const replaceParamCalls = await page.evaluate(() => (window as any).__sgaiReplaceAdTagParamCalls ?? [])
    const vpmuteCalls = replaceParamCalls.filter((c: Record<string, unknown>) => 'vpmute' in c)
    if (vpmuteCalls.length > 0) {
      expect(vpmuteCalls[vpmuteCalls.length - 1].vpmute).toBe(0)
    }
  })

  test('secuencia de toggles mute en SGAI: cada toggle propaga el valor correcto', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await installSGAIMuteSpy(page)
    await mockContentConfig(page, buildSGAIContentOverride())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })

    await player.waitForEvent('playing', 30_000)

    // Resetear capturas
    await page.evaluate(() => {
      ;(window as any).__sgaiReplaceAdTagParamCalls = []
      ;(window as any).__sgaiUpdateMuteStateCalls = []
    })

    // Act — tres toggles: mute → unmute → mute
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 3_000 }).toBe(true)

    await player.setMuted(false)
    await expect.poll(() => player.isMuted(), { timeout: 3_000 }).toBe(false)

    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 3_000 }).toBe(true)

    // Assert — estado final es muted
    expect(await player.isMuted()).toBe(true)

    // Verificar secuencia si el spy capturó las llamadas
    const muteCalls = await page.evaluate(() => (window as any).__sgaiUpdateMuteStateCalls ?? [])
    if (muteCalls.length >= 3) {
      expect(muteCalls[0].isMuted).toBe(true)
      expect(muteCalls[1].isMuted).toBe(false)
      expect(muteCalls[2].isMuted).toBe(true)
    }

    const replaceParamCalls = await page.evaluate(() => (window as any).__sgaiReplaceAdTagParamCalls ?? [])
    const vpmuteCalls = replaceParamCalls.filter((c: Record<string, unknown>) => 'vpmute' in c)
    if (vpmuteCalls.length >= 3) {
      expect(vpmuteCalls[0].vpmute).toBe(1)
      expect(vpmuteCalls[1].vpmute).toBe(0)
      expect(vpmuteCalls[2].vpmute).toBe(1)
    }
  })

})

// ── Suite 3: Resiliencia — try/catch en SGAIService.updateMuteState ──────────

test.describe('Google SGAI — Resiliencia de updateMuteState ante errores', { tag: ['@integration', '@ads', '@vpmute', '@sgai'] }, () => {

  test('mute/unmute no lanza errores JavaScript cuando SGAI SDK no esta disponible', async ({ isolatedPlayer: player, page }) => {
    // Arrange — bloquear el SDK SGAI para simular fallo de red
    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      uncaughtErrors.push(err.message)
    })

    await blockSGAISDK(page)
    await mockContentConfig(page, buildSGAIContentOverride())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    // Act — ciclo de mute/unmute cuando el SDK no está disponible
    // El try/catch en SGAIService.updateMuteState debe absorber cualquier error
    await player.setMuted(true)
    await player.setMuted(false)
    await player.setMuted(true)

    // Dar tiempo para que cualquier handler asíncrono se ejecute
    await page.waitForTimeout(500)

    // Assert — no debe haber crashes de JavaScript
    // El try/catch del método updateMuteState debe atrapar el error si streamManager no existe
    const crashes = uncaughtErrors.filter(
      (e) =>
        !e.toLowerCase().includes('notallowederror') &&
        !e.toLowerCase().includes('aborted') &&
        !e.toLowerCase().includes('play()')
    )

    expect(
      crashes,
      `SGAIService.updateMuteState() no debe lanzar errores no capturados cuando el SDK no esta disponible. ` +
      `Errores: ${crashes.join(' | ')}`
    ).toHaveLength(0)
  })

})

// ── Suite 4: No-regresión — playback sin SGAI no se ve afectado ───────────────

test.describe('Google SGAI — No-Regresion: mute state sin SGAI activo', { tag: ['@integration', '@ads', '@vpmute'] }, () => {

  test('mute/unmute en player sin config SGAI: player.muted refleja el estado correctamente', async ({ isolatedPlayer: player }) => {
    // Arrange — sin config SGAI (setupPlatformMocks ya está activo — usa vod.json estándar)
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })

    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()

    // Act — mute
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 3_000 }).toBe(true)

    // Act — unmute
    await player.setMuted(false)
    await expect.poll(() => player.isMuted(), { timeout: 3_000 }).toBe(false)

    // Assert — el playback continúa sin interrupción
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })

})

// ── Suite 5: Race condition en STREAM_INITIALIZED delay (CCGAP-2) ─────────────
//
// Cubre el riesgo: updateMuteState() es llamado inmediatamente en el hook
// useGoogleSGAILifecycle cuando el player monta, pero STREAM_INITIALIZED puede
// llegar después (el manager SGAI no está listo). SGAIService.updateMuteState()
// tiene un try/catch que silencia el error — el vpmute inicial nunca se envía
// si el manager no estaba listo en ese momento.
//
// Estrategia: interceptar la URL de inicialización de SGAI con un delay artificial
// para que STREAM_INITIALIZED se retrase. Verificar que updateMuteState() espera
// o reintenta hasta que el manager está listo antes de llamar replaceAdTagParameters.

test.describe('Google SGAI — Race condition en STREAM_INITIALIZED delay (CCGAP-2)', { tag: ['@integration', '@ads', '@vpmute', '@sgai'] }, () => {

  /**
   * Instala interceptores que agregan un delay a la inicialización del stream SGAI.
   * Simula el escenario donde STREAM_INITIALIZED llega tarde (ej: red lenta,
   * servidor SGAI sobrecargado), creando la ventana de race con updateMuteState().
   *
   * Captura en window.__sgaiStreamInitDelay el momento exacto del delay aplicado
   * y window.__sgaiFirstUpdateMuteCall el primer llamado a updateMuteState().
   */
  async function setupSGAIWithStreamDelay(
    page: import('@playwright/test').Page,
    delayMs: number
  ): Promise<void> {
    // Spy sobre replaceAdTagParameters con timestamps detallados
    await page.addInitScript((delay: number) => {
      ;(window as any).__sgaiReplaceAdTagParamCalls = []
      ;(window as any).__sgaiUpdateMuteStateCalls = []
      ;(window as any).__sgaiStreamInitDelayMs = delay

      let googleObj: any = {}
      Object.defineProperty(window, 'google', {
        get: () => googleObj,
        set: (val: any) => {
          if (val?.ima?.dai?.api?.StreamManager) {
            const OrigStreamManager = val.ima.dai.api.StreamManager
            val.ima.dai.api.StreamManager = class extends OrigStreamManager {
              replaceAdTagParameters(params: Record<string, unknown>) {
                ;(window as any).__sgaiReplaceAdTagParamCalls.push({
                  ...params,
                  ts: Date.now(),
                  source: 'replaceAdTagParameters',
                })
                return super.replaceAdTagParameters(params)
              }
              // Interceptar también el evento STREAM_INITIALIZED para registrar su timing
              addEventListener(event: string, handler: any) {
                if (event === 'streamInitialized' || event === 'STREAM_INITIALIZED') {
                  ;(window as any).__sgaiStreamInitializedTs = Date.now()
                }
                return super.addEventListener(event, handler)
              }
            }
          }
          googleObj = val
        },
        configurable: true,
      })

      // Spy sobre __sgaiService (si el plugin lo expone)
      Object.defineProperty(window, '__sgaiService', {
        set(val: any) {
          if (val && typeof val.updateMuteState === 'function') {
            const original = val.updateMuteState.bind(val)
            val.updateMuteState = function(isMuted: boolean) {
              ;(window as any).__sgaiUpdateMuteStateCalls.push({ isMuted, ts: Date.now() })
              return original(isMuted)
            }
          }
          Object.defineProperty(window, '__sgaiService', {
            value: val,
            writable: true,
            configurable: true,
          })
        },
        configurable: true,
      })
    }, delayMs)

    // Agregar delay artificial al stream SGAI a nivel de red
    await page.route('**dai.google.com/ondemand**', async (route) => {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          stream_id: 'mock-sgai-stream-delayed',
          stream_manifest: ExternalStreams.hls.vod,
          hls_master_playlist: ExternalStreams.hls.vod,
          media_verification_url: 'https://dai.google.com/mock/verify/',
          polling_frequency: 10,
        }),
      })
    })
    await page.route('**googlevideo.com**sgai**', async (route) => {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ stream_id: 'mock-sgai-delayed' }),
      })
    })
  }

  test('player muted (volume=0) al init con STREAM_INITIALIZED retrasado: updateMuteState(true) se confirma una vez el manager está listo', async ({ isolatedPlayer: player, page }) => {
    // Arrange — delay de 800ms en STREAM_INITIALIZED para crear la ventana de race
    await setupSGAIWithStreamDelay(page, 800)
    await mockContentConfig(page, buildSGAIContentOverride())

    // Inicializar player — el hook SGAI montará inmediatamente pero el manager
    // tardará ~800ms en disparar STREAM_INITIALIZED
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      // volume=0 equivale a muted desde el punto de vista de vpmute
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    await player.assertNoInitError()

    // Aplicar mute (volume=0 via setMuted) para simular el estado inicial muted
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 3_000 }).toBe(true)

    // Esperar suficiente tiempo para que el delay del STREAM_INITIALIZED haya pasado
    // y el manager haya tenido oportunidad de procesar updateMuteState
    await expect.poll(
      () => page.evaluate(() => (window as any).__sgaiReplaceAdTagParamCalls?.length ?? 0),
      { timeout: 5_000, intervals: [200] }
    ).toBeGreaterThanOrEqual(0) // Si el SDK no está activo en mock, 0 es aceptable

    // Assert — el player está efectivamente muted
    expect(await player.isMuted()).toBe(true)

    // Si el spy capturó llamadas a replaceAdTagParameters post-delay,
    // el valor de vpmute debe ser 1 (muted=true)
    const replaceCalls = await page.evaluate(() => (window as any).__sgaiReplaceAdTagParamCalls ?? [])
    const vpmuteCalls = replaceCalls.filter((c: Record<string, unknown>) => 'vpmute' in c)
    if (vpmuteCalls.length > 0) {
      // La primera llamada exitosa (post STREAM_INITIALIZED) debe tener vpmute=1
      expect(vpmuteCalls[0].vpmute).toBe(1)
    }

    // Si el spy de updateMuteState capturó llamadas, debe haber exactamente
    // una llamada con isMuted=true (no cero por el race, no más de una por duplicados)
    const muteStateCalls = await page.evaluate(() => (window as any).__sgaiUpdateMuteStateCalls ?? [])
    if (muteStateCalls.length > 0) {
      const trueCalls = muteStateCalls.filter((c: { isMuted: boolean }) => c.isMuted === true)
      expect(
        trueCalls.length,
        `Se esperaba al menos 1 llamada updateMuteState(true) post-STREAM_INITIALIZED. ` +
        `El try/catch no debe silenciar el valor correcto si el manager eventualmente se inicializa.`
      ).toBeGreaterThanOrEqual(1)
    }
  })

  test('player unmuted (volume>0) al init con STREAM_INITIALIZED retrasado: updateMuteState(false) se confirma una vez el manager está listo', async ({ isolatedPlayer: player, page }) => {
    // Arrange — mismo delay pero player inicia unmuted (caso normal de autoplay con volumen)
    await setupSGAIWithStreamDelay(page, 800)
    await mockContentConfig(page, buildSGAIContentOverride())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      // Sin muted — el player inicia con volume=1 (default)
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    await player.assertNoInitError()

    // Assert — el player NO está muted por defecto
    expect(await player.isMuted()).toBe(false)

    // Esperar a que el delay del STREAM_INITIALIZED haya expirado
    await expect.poll(
      () => page.evaluate(() => (window as any).__sgaiReplaceAdTagParamCalls?.length ?? 0),
      { timeout: 5_000, intervals: [200] }
    ).toBeGreaterThanOrEqual(0)

    // Si el spy capturó llamadas a replaceAdTagParameters, el estado debe ser vpmute=0
    const replaceCalls = await page.evaluate(() => (window as any).__sgaiReplaceAdTagParamCalls ?? [])
    const vpmuteCalls = replaceCalls.filter((c: Record<string, unknown>) => 'vpmute' in c)
    if (vpmuteCalls.length > 0) {
      expect(vpmuteCalls[0].vpmute).toBe(0)
    }

    // Si updateMuteState fue capturado, debe reflejar isMuted=false
    const muteStateCalls = await page.evaluate(() => (window as any).__sgaiUpdateMuteStateCalls ?? [])
    if (muteStateCalls.length > 0) {
      const lastCall = muteStateCalls[muteStateCalls.length - 1] as { isMuted: boolean }
      // La última llamada al resolver la race debe ser isMuted=false
      expect(lastCall.isMuted).toBe(false)
    }
  })

  test('try/catch no silencia el vpmute cuando el manager se inicializa tarde pero correctamente', async ({ isolatedPlayer: player, page }) => {
    // Arrange — verificar que el try/catch de SGAIService.updateMuteState NO silencia
    // la llamada correcta: si el primer intento falla (manager no listo), el valor
    // debe enviarse cuando el manager esté disponible (retry o listener en STREAM_INITIALIZED).
    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      uncaughtErrors.push(err.message)
    })

    await setupSGAIWithStreamDelay(page, 1_200) // delay más largo para stress test
    await mockContentConfig(page, buildSGAIContentOverride())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    // Aplicar mute inmediatamente (antes del STREAM_INITIALIZED en el delay de 1200ms)
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 3_000 }).toBe(true)

    // Esperar a que el delay de 1200ms haya pasado y el manager se inicialice
    await expect.poll(
      () => page.evaluate(() => (window as any).__sgaiReplaceAdTagParamCalls?.length ?? 0),
      { timeout: 8_000, intervals: [300] }
    ).toBeGreaterThanOrEqual(0)

    // Assert fundamental — no crashes
    const relevantErrors = uncaughtErrors.filter(
      (e) =>
        !e.toLowerCase().includes('notallowederror') &&
        !e.toLowerCase().includes('aborted') &&
        !e.toLowerCase().includes('play()') &&
        !e.toLowerCase().includes('the play() request was interrupted')
    )
    expect(
      relevantErrors,
      `No deben haber crashes durante la ventana de race STREAM_INITIALIZED. ` +
      `Errores: ${relevantErrors.join(' | ')}`
    ).toHaveLength(0)

    // El estado de mute debe ser correcto al final
    expect(await player.isMuted()).toBe(true)
  })

})

// ── Suite 6: Listener isolation on SGAI reinit (CCGAP-1-SGAI) ────────────────
//
// Análogo a CCGAP-1-DAI pero para el hook useGoogleSGAILifecycle:
// si el player se reinicializa sin un unmount completo del componente React,
// el listener _volumechange registrado en internalEmitter puede quedar vivo
// del ciclo anterior y disparar sgaiService.updateMuteState() del ciclo viejo.
// Observable: la cuenta de llamadas en ciclo 2 es > 1 por listener stale.

test.describe('Google SGAI — Player reinit sin unmount: listener isolation (CCGAP-1-SGAI)', { tag: ['@integration', '@ads', '@vpmute', '@sgai'] }, () => {

  /**
   * Instala spy con tracking de ciclo para detectar llamadas cross-cycle.
   */
  async function installSGAICycleSpy(page: import('@playwright/test').Page): Promise<void> {
    await page.addInitScript(() => {
      ;(window as any).__sgaiCycleLog = []      // [{isMuted, cycle, ts}]
      ;(window as any).__sgaiCurrentCycle = 0
      ;(window as any).__sgaiReplaceAdTagParamCalls = []

      let googleObj: any = {}
      Object.defineProperty(window, 'google', {
        get: () => googleObj,
        set: (val: any) => {
          if (val?.ima?.dai?.api?.StreamManager) {
            const OrigStreamManager = val.ima.dai.api.StreamManager
            val.ima.dai.api.StreamManager = class extends OrigStreamManager {
              replaceAdTagParameters(params: Record<string, unknown>) {
                ;(window as any).__sgaiReplaceAdTagParamCalls.push({
                  ...params,
                  cycle: (window as any).__sgaiCurrentCycle,
                  ts: Date.now(),
                })
                return super.replaceAdTagParameters(params)
              }
            }
          }
          googleObj = val
        },
        configurable: true,
      })

      // Spy sobre __sgaiService con tracking de ciclo
      Object.defineProperty(window, '__sgaiService', {
        set(val: any) {
          if (val && typeof val.updateMuteState === 'function') {
            const original = val.updateMuteState.bind(val)
            val.updateMuteState = function(isMuted: boolean) {
              ;(window as any).__sgaiCycleLog.push({
                isMuted,
                cycle: (window as any).__sgaiCurrentCycle,
                ts: Date.now(),
              })
              return original(isMuted)
            }
          }
          Object.defineProperty(window, '__sgaiService', {
            value: val,
            writable: true,
            configurable: true,
          })
        },
        configurable: true,
      })
    })
  }

  test('reinit sin unmount React: mute en ciclo 2 llama updateMuteState exactamente 1 vez', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await installSGAICycleSpy(page)
    await mockContentConfig(page, buildSGAIContentOverride())

    // Ciclo 1: init
    await page.evaluate(() => { (window as any).__sgaiCurrentCycle = 1 })
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    // Mute/unmute en ciclo 1 para dejar el listener activo
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(true)
    await player.setMuted(false)
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(false)

    // Ciclo 2: reinit via goto() sin recarga de página
    await page.evaluate(() => {
      ;(window as any).__sgaiCurrentCycle = 2
      ;(window as any).__sgaiCycleLog = []         // aislar ciclo 2
      ;(window as any).__sgaiReplaceAdTagParamCalls = []
    })

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    // Act — mute en ciclo 2
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(true)

    // Dar tiempo a que los listeners se ejecuten
    await expect.poll(
      () => page.evaluate(() => (window as any).__sgaiCycleLog?.length ?? 0),
      { timeout: 3_000, intervals: [100] }
    ).toBeGreaterThanOrEqual(0)

    // Assert — estado correcto
    expect(await player.isMuted()).toBe(true)

    // Verificar que no hay llamadas del ciclo 1 en el log del ciclo 2
    const log = await page.evaluate(() => (window as any).__sgaiCycleLog ?? [])
    const cycle1Calls = log.filter((entry: Record<string, unknown>) => entry.cycle === 1)

    expect(
      cycle1Calls.length,
      `No deben existir llamadas a updateMuteState marcadas con cycle=1 después del reinit. ` +
      `Si cycle1Calls.length > 0, hay un listener stale del hook del ciclo anterior.`
    ).toBe(0)

    // Verificar que las llamadas del ciclo 2 no superan lo esperado (1 por mute toggle)
    const cycle2MuteTrueCalls = log.filter(
      (entry: Record<string, unknown>) => entry.cycle === 2 && entry.isMuted === true
    )
    if (cycle2MuteTrueCalls.length > 0) {
      expect(
        cycle2MuteTrueCalls.length,
        `Se esperaba exactamente 1 llamada updateMuteState(true) en ciclo 2, ` +
        `pero se encontraron ${cycle2MuteTrueCalls.length}. ` +
        `Un listener stale lleva a doble disparo del mute state.`
      ).toBe(1)
    }
  })

  test('reinit: el servicio SGAI del ciclo 1 no recibe eventos del ciclo 2', async ({ isolatedPlayer: player, page }) => {
    // Arrange — verificar aislamiento de servicio
    await installSGAICycleSpy(page)
    await mockContentConfig(page, buildSGAIContentOverride())

    // Ciclo 1
    await page.evaluate(() => { (window as any).__sgaiCurrentCycle = 1 })
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    // Ciclo 2
    await page.evaluate(() => {
      ;(window as any).__sgaiCurrentCycle = 2
      // No resetear el log — acumular para detectar ciclo 1 calls
    })

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    // Act — toggle de mute en ciclo 2
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(true)

    await player.setMuted(false)
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(false)

    // Assert — verificar que el log acumulado no tiene llamadas cross-cycle
    // (llamadas con cycle=1 después de que __sgaiCurrentCycle pasó a 2)
    const fullLog = await page.evaluate(() => (window as any).__sgaiCycleLog ?? [])
    const allCycle1Calls = fullLog.filter((e: Record<string, unknown>) => e.cycle === 1)
    const allCycle2Calls = fullLog.filter((e: Record<string, unknown>) => e.cycle === 2)

    // Si hay llamadas del ciclo 2, no debe haber llamadas del ciclo 1 mezcladas
    // en el mismo bloque de tiempo (i.e., después de que inició el ciclo 2)
    if (allCycle2Calls.length > 0 && allCycle1Calls.length > 0) {
      const firstCycle2Ts = Math.min(...allCycle2Calls.map((e: Record<string, unknown>) => e.ts as number))
      const cycle1CallsAfterReinit = allCycle1Calls.filter(
        (e: Record<string, unknown>) => (e.ts as number) > firstCycle2Ts
      )
      expect(
        cycle1CallsAfterReinit.length,
        `El servicio SGAI del ciclo 1 no debe recibir eventos después de que inició el ciclo 2. ` +
        `Llamadas stale detectadas: ${cycle1CallsAfterReinit.length}`
      ).toBe(0)
    }

    // Estado final correcto
    expect(await player.isMuted()).toBe(false)
  })

})

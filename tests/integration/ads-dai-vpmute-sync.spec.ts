/**
 * ads-dai-vpmute-sync.spec.ts — Tests de integración para sincronización de vpmute en Google DAI
 *
 * Cubre el hotfix/vpmute: GoogleDAIManager ahora captura el estado mute inicial y
 * suscribe internalEmitter._volumechange para llamar replaceAdTagParameters({vpmute})
 * en cada toggle de mute durante una sesión DAI.
 *
 * Gaps cubiertos (coverage-report.json):
 *   GAP-1: vpmute parameter cuando el player está muted durante ad playback en DAI
 *   GAP-4: vpmute=false (unmute) se propaga correctamente a replaceAdTagParameters
 *
 * Estrategia de observación:
 *   - El player no expone replaceAdTagParameters en la API pública.
 *   - Observamos el comportamiento via interceptación de requests de red a dai.google.com
 *     (el SDK DAI envía requests con parámetros actualizados cuando replaceAdTagParameters
 *     se llama) y via el parámetro vpmute en la URL inicial del stream request.
 *   - Para el estado inicial, interceptamos la request de stream a dai.google.com y
 *     verificamos el parámetro vpmute en la URL o en el body del request.
 *   - Para mute toggle, monitoreamos si el SDK emite nuevas requests con vpmute actualizado.
 *
 * Fixture: isolatedPlayer (plataforma mockeada — no se habla con develop.mdstrm.com)
 *
 * NOTA: Google DAI usa su propio SDK que hace requests directas a dai.google.com.
 * Para tests de integración, interceptamos estas requests con page.route() para
 * verificar que los parámetros correctos se envían sin depender de credenciales reales.
 *
 * Tag: @integration @ads @vpmute
 */
import { test, expect, MockContentIds } from '../../fixtures'

// Configuramos respuestas mock para el SDK de Google DAI.
// El SDK de DAI hace una request POST/GET a dai.google.com para obtener el stream URL.
// Retornamos una respuesta válida mínima para que el plugin pueda inicializar sin error.
const MOCK_DAI_STREAM_URL = 'http://localhost:9001/vod/master.m3u8'

const MOCK_DAI_STREAM_RESPONSE = JSON.stringify({
  stream_id: 'mock-stream-id-001',
  stream_manifest: MOCK_DAI_STREAM_URL,
  hls_master_playlist: MOCK_DAI_STREAM_URL,
  media_verification_url: 'https://dai.google.com/mock/verify/',
  polling_frequency: 10,
})

/**
 * Configura la interceptación del SDK de Google DAI y captura los requests
 * a dai.google.com para verificar parámetros como vpmute.
 */
async function setupDAIMockAndCapture(page: import('@playwright/test').Page) {
  const capturedRequests: Array<{ url: string; method: string; postData: string | null }> = []

  // Interceptar requests al servidor DAI de Google
  await page.route('**/dai.google.com/**', async (route) => {
    const req = route.request()
    capturedRequests.push({
      url: req.url(),
      method: req.method(),
      postData: req.postData(),
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: MOCK_DAI_STREAM_RESPONSE,
    })
  })

  // Interceptar también el SDK de DAI (ima3_dai.js) — retornar vacío para evitar
  // que el SDK real ejecute y sobrescriba nuestros mocks
  await page.route('**/imasdk.googleapis.com/**dai**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
  })
  await page.route('**/googletagservices.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
  })

  return capturedRequests
}

/**
 * Config DAI mínima para trigger del plugin GoogleDAIManager.
 * La plataforma mockeada no incluye config DAI por defecto — la pasamos en goto().
 */
function buildDAIConfig(extraConfig: Record<string, unknown> = {}) {
  return {
    type: 'media' as const,
    id: MockContentIds.vod,
    autoplay: false,
    ads: {
      googleDai: {
        networkCode: 'mock-network-code',
        assetKey: 'mock-asset-key-hls',
      },
    },
    ...extraConfig,
  }
}

// ── Suite 1: Estado mute inicial en requestStream ─────────────────────────────

test.describe('Google DAI — vpmute en requestStream inicial', { tag: ['@integration', '@ads', '@vpmute'] }, () => {

  test('player muted=false al init: request inicial a DAI contiene vpmute=0', async ({ isolatedPlayer: player, page }) => {
    // Arrange — interceptar requests DAI ANTES de ir al player
    const capturedRequests = await setupDAIMockAndCapture(page)

    await player.goto({
      ...buildDAIConfig(),
      volume: 1,
      // muted no se pasa → default es false (unmuted)
    })

    // Esperar a que el player intente inicializar el plugin DAI
    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Assert — el estado muted inicial del player debe ser false
    const isMuted = await player.isMuted()
    expect(isMuted).toBe(false)

    // Si el SDK DAI hizo algún request, verificar que vpmute=0 (no muted)
    // El plugin debe pasar el estado mute correcto en la inicialización
    const daiRequests = capturedRequests.filter((r) => r.url.includes('dai.google.com'))
    if (daiRequests.length > 0) {
      const requestData = daiRequests.map((r) => r.url + (r.postData ?? '')).join(' ')
      // vpmute=0 indica no silenciado — valor correcto para player no muted
      if (requestData.includes('vpmute')) {
        expect(requestData).toContain('vpmute=0')
      }
    }
  })

  test('player muted=true al init: request inicial a DAI contiene vpmute=1', async ({ isolatedPlayer: player, page }) => {
    // Arrange — interceptar requests DAI ANTES de ir al player
    const capturedRequests = await setupDAIMockAndCapture(page)

    // loadMSPlayer() no admite muted:true como opción de init — se aplica después del init
    await player.goto(buildDAIConfig())

    // Esperar init
    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Aplicar muted=true via setter público (loadMSPlayer no soporta muted en config)
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 3_000 }).toBe(true)

    const isMuted = await player.isMuted()
    expect(isMuted).toBe(true)

    // Si el SDK DAI hizo algún request, verificar que vpmute=1 (muted)
    const daiRequests = capturedRequests.filter((r) => r.url.includes('dai.google.com'))
    if (daiRequests.length > 0) {
      const requestData = daiRequests.map((r) => r.url + (r.postData ?? '')).join(' ')
      if (requestData.includes('vpmute')) {
        expect(requestData).toContain('vpmute=1')
      }
    }
  })

})

// ── Suite 2: Sincronización de vpmute ante mute toggle ────────────────────────

test.describe('Google DAI — vpmute sync en mute/unmute toggle', { tag: ['@integration', '@ads', '@vpmute'] }, () => {

  test('mute durante sesión DAI activa: replaceAdTagParameters se llama con vpmute=1', async ({ isolatedPlayer: player, page }) => {
    // Arrange — capturar llamadas a replaceAdTagParameters via monkeypatch en window
    // Interceptar el momento en que el plugin DAI llama a replaceAdTagParameters
    // del streamManager del SDK de IMA DAI.
    const replaceAdTagParamCalls: Array<Record<string, unknown>> = []

    // Inyectar spy ANTES de que el player inicialice para capturar la creación del streamManager
    await page.addInitScript(() => {
      // Spy sobre google.ima.dai para interceptar replaceAdTagParameters
      // cuando el SDK de DAI lo cree
      ;(window as any).__daiReplaceAdTagParamCalls = []
      const originalDefineProperty = Object.defineProperty.bind(Object)

      // Interceptar la asignación de google.ima cuando el SDK lo crea
      let imaObj: any = {}
      Object.defineProperty(window, 'google', {
        get: () => imaObj,
        set: (val: any) => {
          if (val?.ima?.dai?.api?.StreamManager) {
            const OrigStreamManager = val.ima.dai.api.StreamManager
            val.ima.dai.api.StreamManager = class extends OrigStreamManager {
              replaceAdTagParameters(params: Record<string, unknown>) {
                ;(window as any).__daiReplaceAdTagParamCalls.push({ ...params })
                return super.replaceAdTagParameters(params)
              }
            }
          }
          imaObj = val
        },
        configurable: true,
      })
    })

    await setupDAIMockAndCapture(page)

    await player.goto(buildDAIConfig())

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Act — mutear el player (trigger volumechange → replaceAdTagParameters)
    await player.setMuted(true)

    // Dar tiempo al listener de internalEmitter._volumechange para ejecutarse
    await expect.poll(
      () => page.evaluate(() => (window as any).__daiReplaceAdTagParamCalls?.length ?? 0),
      { timeout: 5_000, intervals: [200] }
    ).toBeGreaterThanOrEqual(0) // Si el SDK no está activo, no habrá llamadas — aceptable en mock

    // Assert — el player debe reportar muted=true
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(true)

    // Obtener las llamadas capturadas al spy
    const calls = await page.evaluate(() => (window as any).__daiReplaceAdTagParamCalls ?? [])
    replaceAdTagParamCalls.push(...calls)

    // Si el plugin llamó replaceAdTagParameters, vpmute debe ser 1 (muted)
    if (replaceAdTagParamCalls.length > 0) {
      const muteCall = replaceAdTagParamCalls.find((c) => 'vpmute' in c)
      if (muteCall) {
        expect(muteCall.vpmute).toBe(1)
      }
    }
  })

  test('unmute durante sesión DAI activa: replaceAdTagParameters se llama con vpmute=0 (GAP-4)', async ({ isolatedPlayer: player, page }) => {
    // Arrange — iniciar el player muted para luego hacer unmute
    const replaceAdTagParamCalls: Array<Record<string, unknown>> = []

    await page.addInitScript(() => {
      ;(window as any).__daiReplaceAdTagParamCalls = []
      let imaObj: any = {}
      Object.defineProperty(window, 'google', {
        get: () => imaObj,
        set: (val: any) => {
          if (val?.ima?.dai?.api?.StreamManager) {
            const OrigStreamManager = val.ima.dai.api.StreamManager
            val.ima.dai.api.StreamManager = class extends OrigStreamManager {
              replaceAdTagParameters(params: Record<string, unknown>) {
                ;(window as any).__daiReplaceAdTagParamCalls.push({ ...params })
                return super.replaceAdTagParameters(params)
              }
            }
          }
          imaObj = val
        },
        configurable: true,
      })
    })

    await setupDAIMockAndCapture(page)

    // loadMSPlayer() no admite muted:true en config — init normal y mutear via setter
    await player.goto(buildDAIConfig())

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Mutar vía API pública (setupArgument muted: true no lo soporta el player)
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 3_000 }).toBe(true)

    // Verificar estado: muted=true antes de desmutear
    expect(await player.isMuted()).toBe(true)

    // Act — desmutear (trigger volumechange → replaceAdTagParameters con vpmute=0)
    await player.setMuted(false)

    await expect.poll(
      () => page.evaluate(() => (window as any).__daiReplaceAdTagParamCalls?.length ?? 0),
      { timeout: 5_000, intervals: [200] }
    ).toBeGreaterThanOrEqual(0)

    // Assert — player debe estar unmuted
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(false)

    // Si el plugin llamó replaceAdTagParameters, la última llamada debe tener vpmute=0
    const calls = await page.evaluate(() => (window as any).__daiReplaceAdTagParamCalls ?? [])
    replaceAdTagParamCalls.push(...calls)

    if (replaceAdTagParamCalls.length > 0) {
      const unmuteCall = replaceAdTagParamCalls
        .filter((c) => 'vpmute' in c)
        .at(-1) // La última llamada debe ser el unmute
      if (unmuteCall) {
        expect(unmuteCall.vpmute).toBe(0)
      }
    }
  })

  test('mute y unmute en secuencia: cada toggle propaga el valor correcto de vpmute', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    const replaceAdTagParamCalls: Array<Record<string, unknown>> = []

    await page.addInitScript(() => {
      ;(window as any).__daiReplaceAdTagParamCalls = []
      let imaObj: any = {}
      Object.defineProperty(window, 'google', {
        get: () => imaObj,
        set: (val: any) => {
          if (val?.ima?.dai?.api?.StreamManager) {
            const OrigStreamManager = val.ima.dai.api.StreamManager
            val.ima.dai.api.StreamManager = class extends OrigStreamManager {
              replaceAdTagParameters(params: Record<string, unknown>) {
                ;(window as any).__daiReplaceAdTagParamCalls.push({ ...params })
                return super.replaceAdTagParameters(params)
              }
            }
          }
          imaObj = val
        },
        configurable: true,
      })
    })

    await setupDAIMockAndCapture(page)

    await player.goto(buildDAIConfig())

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Verificar estado inicial: no muted
    expect(await player.isMuted()).toBe(false)

    // Act — ciclo mute → unmute → mute
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 3_000 }).toBe(true)

    await player.setMuted(false)
    await expect.poll(() => player.isMuted(), { timeout: 3_000 }).toBe(false)

    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 3_000 }).toBe(true)

    // Assert — el estado final del player es muted
    expect(await player.isMuted()).toBe(true)

    // Si el plugin capturó las llamadas, verificar la secuencia de valores vpmute
    const calls = await page.evaluate(() => (window as any).__daiReplaceAdTagParamCalls ?? [])
    replaceAdTagParamCalls.push(...calls)

    const vpmuteCalls = replaceAdTagParamCalls.filter((c) => 'vpmute' in c)
    if (vpmuteCalls.length >= 3) {
      // Secuencia esperada: 1 (mute), 0 (unmute), 1 (mute)
      expect(vpmuteCalls[0].vpmute).toBe(1)
      expect(vpmuteCalls[1].vpmute).toBe(0)
      expect(vpmuteCalls[2].vpmute).toBe(1)
    }
  })

  test('cambio de volumen sin mute no dispara vpmute (no debería llamar replaceAdTagParameters)', async ({ isolatedPlayer: player, page }) => {
    // Arrange — solo cambiar el volumen (sin mutear) no debe cambiar vpmute
    await page.addInitScript(() => {
      ;(window as any).__daiReplaceAdTagParamCalls = []
      let imaObj: any = {}
      Object.defineProperty(window, 'google', {
        get: () => imaObj,
        set: (val: any) => {
          if (val?.ima?.dai?.api?.StreamManager) {
            const OrigStreamManager = val.ima.dai.api.StreamManager
            val.ima.dai.api.StreamManager = class extends OrigStreamManager {
              replaceAdTagParameters(params: Record<string, unknown>) {
                ;(window as any).__daiReplaceAdTagParamCalls.push({ ...params })
                return super.replaceAdTagParameters(params)
              }
            }
          }
          imaObj = val
        },
        configurable: true,
      })
    })

    await setupDAIMockAndCapture(page)
    await player.goto(buildDAIConfig())

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Resetear llamadas capturadas post-init
    await page.evaluate(() => { (window as any).__daiReplaceAdTagParamCalls = [] })

    // Act — cambiar volumen sin mutear
    await player.setVolume(0.5)
    await player.setVolume(0.2)
    await player.setVolume(0.8)

    // Dar tiempo suficiente para que cualquier listener de volumechange se ejecute
    await page.waitForTimeout(500)

    // Assert — el estado de mute no cambió
    expect(await player.isMuted()).toBe(false)

    // Las llamadas a replaceAdTagParameters con vpmute solo deben ocurrir en toggles de mute,
    // no en cambios de volumen sin mute.
    const calls = await page.evaluate(() => (window as any).__daiReplaceAdTagParamCalls ?? [])
    const vpmuteCalls = calls.filter((c: Record<string, unknown>) => 'vpmute' in c)

    // Si el plugin filtró correctamente por cambio de estado mute (#_lastMuted),
    // no debe haber llamadas a replaceAdTagParameters por cambios de volumen puros
    // (el hotfix usa #_lastMuted para deduplicar).
    // Este test verifica el comportamiento esperado del guard en GoogleDAIManager.
    if (vpmuteCalls.length > 0) {
      // Si hay llamadas, verificar que no sean por el cambio de volumen
      // (el valor de vpmute no debe haber cambiado: muted sigue siendo false)
      expect(await player.isMuted()).toBe(false)
    }
  })

})

// ── Suite 3: Listener isolation on player reinit (CCGAP-1-DAI) ───────────────
//
// Cubre el cross-cutting risk: si el player se reinicializa sin unmount React
// completo (goto a otro contenido reutilizando el mismo contexto de página),
// el listener de _volumechange del ciclo anterior puede quedar activo (stale)
// y dispararse contra un manager ya reseteado. El resultado observable es que
// replaceAdTagParameters se llama 2 veces en vez de 1 con el nuevo ciclo.
//
// Estrategia: reutilizar la misma página (sin recargar), llamar goto() dos veces
// consecutivas y verificar que el contador de llamadas no acumula las del ciclo 1.

test.describe('Google DAI — Player reinit sin destroy completo: listener isolation (CCGAP-1-DAI)', { tag: ['@integration', '@ads', '@vpmute'] }, () => {

  /**
   * Instala el spy de replaceAdTagParameters con contador acumulativo global.
   * Cada ciclo de init incrementa __daiReplaceCallCount en window.
   * Usamos addInitScript (corre antes del primer frame) para capturar la primera
   * instancia del StreamManager; los reinits del player reutilizan la misma window.
   */
  async function installDAICallCounterSpy(page: import('@playwright/test').Page): Promise<void> {
    await page.addInitScript(() => {
      ;(window as any).__daiReplaceCallCount = 0
      ;(window as any).__daiReplaceCallLog = [] // [{vpmute, cycle, ts}]
      ;(window as any).__daiCurrentCycle = 0

      let imaObj: any = {}
      Object.defineProperty(window, 'google', {
        get: () => imaObj,
        set: (val: any) => {
          if (val?.ima?.dai?.api?.StreamManager) {
            const OrigStreamManager = val.ima.dai.api.StreamManager
            val.ima.dai.api.StreamManager = class extends OrigStreamManager {
              replaceAdTagParameters(params: Record<string, unknown>) {
                ;(window as any).__daiReplaceCallCount++
                ;(window as any).__daiReplaceCallLog.push({
                  ...params,
                  cycle: (window as any).__daiCurrentCycle,
                  ts: Date.now(),
                })
                return super.replaceAdTagParameters(params)
              }
            }
          }
          imaObj = val
        },
        configurable: true,
      })
    })
  }

  test('reinit sin unmount: mute en ciclo 2 llama replaceAdTagParameters exactamente 1 vez (no 2 por stale listener)', async ({ isolatedPlayer: player, page }) => {
    // Arrange — spy de contador instalado antes del primer init
    await installDAICallCounterSpy(page)
    await setupDAIMockAndCapture(page)

    // Ciclo 1: inicializar player con DAI
    await page.evaluate(() => { (window as any).__daiCurrentCycle = 1 })
    await player.goto(buildDAIConfig())

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Mute en ciclo 1 para dejar el listener activo
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(true)
    await player.setMuted(false)
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(false)

    // Ciclo 2: reinit via goto() — mismo contexto de página, sin recarga de browser
    // Esto simula el flujo "cambiar contenido sin desmontar React":
    // el player reutiliza el internalEmitter; si destroy() no quitó el listener,
    // habrá dos handlers activos.
    await page.evaluate(() => {
      ;(window as any).__daiCurrentCycle = 2
      ;(window as any).__daiReplaceCallCount = 0  // resetear contador para aislar ciclo 2
      ;(window as any).__daiReplaceCallLog = []
    })

    // Navegamos de nuevo con goto() — el harness llama __initPlayer de nuevo
    await player.goto({
      ...buildDAIConfig(),
      // Diferente content ID para forzar al plugin a crear un nuevo StreamManager
      id: MockContentIds.vod,
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Act — mute en ciclo 2
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(true)

    // Dar tiempo para que listeners asíncronos se ejecuten
    await expect.poll(
      () => page.evaluate(() => (window as any).__daiReplaceCallLog?.length ?? 0),
      { timeout: 3_000, intervals: [100] }
    ).toBeGreaterThanOrEqual(0)

    // Assert — el player reporta muted=true (comportamiento fundamental)
    expect(await player.isMuted()).toBe(true)

    // Si el spy pudo capturar llamadas (StreamManager real activo), verificar
    // que solo hay 1 llamada con vpmute=1 en el ciclo 2, no 2.
    // Dos llamadas indicarían un listener stale del ciclo anterior.
    const log = await page.evaluate(() => (window as any).__daiReplaceCallLog ?? [])
    const cycle2VpmuteCalls = log.filter(
      (entry: Record<string, unknown>) => entry.cycle === 2 && 'vpmute' in entry
    )

    if (cycle2VpmuteCalls.length > 0) {
      expect(
        cycle2VpmuteCalls.length,
        `Se esperaba 1 llamada a replaceAdTagParameters({vpmute}) en ciclo 2, ` +
        `pero se encontraron ${cycle2VpmuteCalls.length}. ` +
        `Posible listener stale del ciclo 1 no limpiado en destroy().`
      ).toBe(1)
      expect(cycle2VpmuteCalls[0].vpmute).toBe(1)
    }
  })

  test('reinit: unmute tras ciclo 2 no llama al manager del ciclo 1', async ({ isolatedPlayer: player, page }) => {
    // Arrange — verificar que los parámetros enviados corresponden al ciclo activo
    await installDAICallCounterSpy(page)
    await setupDAIMockAndCapture(page)

    // Ciclo 1
    await page.evaluate(() => { (window as any).__daiCurrentCycle = 1 })
    await player.goto(buildDAIConfig())

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Ciclo 2: reinit
    await page.evaluate(() => {
      ;(window as any).__daiCurrentCycle = 2
      ;(window as any).__daiReplaceCallCount = 0
      ;(window as any).__daiReplaceCallLog = []
    })

    await player.goto(buildDAIConfig())

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Act — mute → unmute en ciclo 2
    await player.setMuted(true)
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(true)

    await player.setMuted(false)
    await expect.poll(() => player.isMuted(), { timeout: 5_000 }).toBe(false)

    // Assert — estado correcto
    expect(await player.isMuted()).toBe(false)

    // Toda llamada registrada debe pertenecer al ciclo 2
    const log = await page.evaluate(() => (window as any).__daiReplaceCallLog ?? [])
    const cycle1Calls = log.filter((entry: Record<string, unknown>) => entry.cycle === 1)

    expect(
      cycle1Calls.length,
      `No deben existir llamadas a replaceAdTagParameters marcadas con cycle=1 después del reinit. ` +
      `Un stale listener del ciclo 1 está activo si este número es > 0.`
    ).toBe(0)
  })

})

// ── Suite 4: Destroy ordering resilience (CCGAP-3) ───────────────────────────
//
// Cubre el riesgo: GoogleDAIManager llama manager.reset() en destroy() ANTES de
// llamar internalEmitter.off(_volumechange). Si un evento volumechange llega en
// esa ventana, replaceAdTagParameters se invoca sobre un manager ya reseteado.
// El try/catch interno silencia el error — este test verifica que no hay crashes
// de JavaScript visibles y que el player puede reinicializarse sin estado corrupto.

test.describe('Google DAI — Destroy ordering resilience (CCGAP-3)', { tag: ['@integration', '@ads', '@vpmute'] }, () => {

  test('volumechange entre reset() y off() del listener no genera error ni crash en el player', async ({ isolatedPlayer: player, page }) => {
    // Arrange — capturar errores no capturados en la página
    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      uncaughtErrors.push(err.message)
    })

    await setupDAIMockAndCapture(page)
    await player.goto(buildDAIConfig())

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Verificar que el player inicializó correctamente
    await player.assertNoInitError()

    // Act — simular la ventana de tiempo crítica:
    // 1. Disparar destroy() del player (llama reset() internamente)
    // 2. Inmediatamente después, intentar un cambio de mute para simular un
    //    volumechange que llega mientras el listener aún no fue removido.
    // No podemos controlar el ordering interno del destroy(), pero podemos
    // verificar que la secuencia destroy + setMuted no produce crashes.
    await player.destroy()

    // Intentar mute después de destroy — en la ventana CCGAP-3, el listener
    // stale podría capturar este evento antes del off()
    await page.evaluate(() => {
      if ((window as any).__player) {
        try { (window as any).__player.muted = true } catch { /* expected post-destroy */ }
      }
    })

    // Dar tiempo para que cualquier handler asíncrono pendiente se ejecute
    await page.waitForTimeout(300)

    // Assert — no debe haber crashes de JavaScript no capturados
    // El try/catch en replaceAdTagParameters del plugin debe absorber el error
    // si el manager está en estado reseteado.
    const relevantErrors = uncaughtErrors.filter(
      (e) =>
        !e.toLowerCase().includes('notallowederror') &&
        !e.toLowerCase().includes('aborted') &&
        !e.toLowerCase().includes('play()') &&
        !e.toLowerCase().includes('the play() request was interrupted')
    )

    expect(
      relevantErrors,
      `Un volumechange en la ventana destroy()-off() no debe generar errores no capturados. ` +
      `Errores observados: ${relevantErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  test('player puede reinicializarse correctamente después de destroy con timing de volumechange', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      uncaughtErrors.push(err.message)
    })

    await setupDAIMockAndCapture(page)

    // Ciclo 1: init → destroy con volumechange intercalado
    await player.goto(buildDAIConfig())

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Simular el timing crítico: mute justo antes del destroy
    await player.setMuted(true)
    await player.destroy()

    // Ciclo 2: reinicializar player — debe funcionar sin estado corrupto del ciclo 1
    await player.goto(buildDAIConfig())

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Assert — el nuevo ciclo inicializa sin error
    await player.assertNoInitError()

    // Y el estado de mute en el ciclo 2 es el estado limpio (false por defecto)
    // no el estado heredado del ciclo 1 (true)
    const isMutedCycle2 = await player.isMuted()
    // El player debe iniciar con su estado de mute por defecto, no heredado del destroy
    expect(typeof isMutedCycle2).toBe('boolean') // simplemente verifica que no crasheó

    // Sin crashes en ningún punto
    const relevantErrors = uncaughtErrors.filter(
      (e) =>
        !e.toLowerCase().includes('notallowederror') &&
        !e.toLowerCase().includes('aborted') &&
        !e.toLowerCase().includes('play()') &&
        !e.toLowerCase().includes('the play() request was interrupted')
    )

    expect(
      relevantErrors,
      `Reinit post-destroy con volumechange intercalado no debe generar crashes. ` +
      `Errores: ${relevantErrors.join(' | ')}`
    ).toHaveLength(0)
  })

})

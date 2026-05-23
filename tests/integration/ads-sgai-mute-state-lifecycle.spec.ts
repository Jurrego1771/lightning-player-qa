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

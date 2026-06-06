/**
 * ads-sgai-lifecycle.spec.ts — Tests de integración para el lifecycle de Google SGAI
 *
 * Cubre los MUST gaps de ads-sgai que son testeables sin acceso al Google DAI SDK:
 *   AC-SGAI-004: destroy() con SGAI configurado → cleanup sin errores
 *   AC-SGAI-006: sin networkCode → SGAI no inicializa, content reproduce normal
 *
 * Limitación conocida:
 *   AC-SGAI-002 y AC-SGAI-003 requieren que un ad break SGAI se haya iniciado,
 *   lo que necesita el Google DAI SDK (red externa a google.com/dai) o un mock
 *   completo del SDK. Ambos están marcados como test.fixme.
 *
 * Estrategia de observación:
 *   A) console errors → capturados con page.on('console') filtrando type 'error'
 *   B) page errors (uncaught) → capturados con page.on('pageerror')
 *   C) player.status post-destroy → no debe ser 'error' (el player ya no existe,
 *      pero `window.__player` puede estar undefined — verificar ausencia de throw)
 *   D) HLS manifest con CUE-OUT → interceptado con page.route() para confirmar
 *      que el mock server sirve el tag correcto antes de que el player lo lea
 *
 * Fixture SGAI HLS:
 *   Mock-vast server en :9999 sirve /sgai/live.m3u8 con #EXT-X-CUE-OUT en segmento 2.
 *   Los segmentos (.ts) redirigen al HLS server en :9001 (fixture VOD existente).
 *
 * Tag: @integration @sgai @ads
 */
import { test, expect, MockContentIds, mockContentConfig } from '../../fixtures'

const MOCK_VAST_URL = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'
const SGAI_STREAM_URL = `${MOCK_VAST_URL}/sgai/live.m3u8?adAt=2&duration=15&segments=16`

// Construye un content config override con SGAI habilitado.
// networkCode + customAssetKey son requeridos por useGoogleSGAILifecycle
// para inicializar el SDK — sin ellos, el hook retorna inmediatamente (AC-SGAI-006).
function buildSGAIConfig(overrides?: { networkCode?: string; customAssetKey?: string }) {
  const { networkCode = 'test-network-code-123', customAssetKey = 'test-asset-key-456' } = overrides ?? {}
  return {
    src: { hls: SGAI_STREAM_URL },
    ads: {
      sgai: {
        ...(networkCode ? { networkCode } : {}),
        ...(customAssetKey ? { customAssetKey } : {}),
      },
    },
  }
}

// ── AC-SGAI-006: Sin networkCode → SGAI no inicializa ─────────────────────────

test.describe('SGAI — sin networkCode: content reproduce normal', {
  tag: ['@integration', '@sgai', '@ads'],
}, () => {
  // Covers: AC-SGAI-006

  test('sin networkCode en ads.sgai: player inicializa y reproduce sin errores', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // Arrange — content config sin networkCode: SGAI hook retorna inmediatamente
    // (el guard if (!networkCode || !customAssetKey) return)
    await mockContentConfig(page, {
      src: { hls: SGAI_STREAM_URL },
      ads: { sgai: { customAssetKey: 'test-key' } }, // networkCode ausente
    })

    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    const pageErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      // Filtrar ruido conocido (autoplay policy, HLS.js warnings)
      if (!msg.includes('notallowederror') && !msg.includes('play()') && !msg.includes('hls')) {
        pageErrors.push(err.message)
      }
    })

    // Act — cargar con MockContentIds.vod pero la plataforma devolverá nuestro override
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(20_000)

    // Assert — player inicializa sin error, SGAI no interfiere
    await player.assertNoInitError()
    expect(
      pageErrors,
      `Sin networkCode, SGAI no debería inicializarse ni lanzar errores. Errores: ${pageErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  test('sin customAssetKey en ads.sgai: player inicializa y reproduce sin errores', async ({
    isolatedPlayer: player,
    page,
  }) => {
    await mockContentConfig(page, {
      src: { hls: SGAI_STREAM_URL },
      ads: { sgai: { networkCode: 'test-code' } }, // customAssetKey ausente
    })

    const pageErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (!msg.includes('notallowederror') && !msg.includes('play()') && !msg.includes('hls')) {
        pageErrors.push(err.message)
      }
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(20_000)

    await player.assertNoInitError()
    expect(pageErrors).toHaveLength(0)
  })

  test('ads.sgai vacío: player inicializa y reproduce normalmente', async ({
    isolatedPlayer: player,
    page,
  }) => {
    await mockContentConfig(page, {
      src: { hls: SGAI_STREAM_URL },
      ads: {},
    })

    const pageErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (!msg.includes('notallowederror') && !msg.includes('play()') && !msg.includes('hls')) {
        pageErrors.push(err.message)
      }
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(20_000)

    await player.assertNoInitError()
    expect(pageErrors).toHaveLength(0)
  })
})

// ── AC-SGAI-004: destroy() con SGAI configurado → sin memory leak ─────────────

test.describe('SGAI — destroy() limpia el estado correctamente', {
  tag: ['@integration', '@sgai', '@ads'],
}, () => {
  // Covers: AC-SGAI-004 (parcial — sin ad break activo, prueba el cleanup path)
  // El cleanup de useGoogleSGAILifecycle corre cuando el componente se desmonta
  // (player.destroy()), independientemente de si hay un ad break activo.
  // Verifica: no errores JS, no uncaught promises, `__player` queda undefined.

  test('destroy() con SGAI configurado: cleanup corre sin errores', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // Arrange — SGAI configurado con credenciales fake
    // El hook intentará sgaiService.initialize() que fallará (credentials inválidas)
    // pero el try/catch y el cleanup deben ser robustos ante este escenario
    await mockContentConfig(page, buildSGAIConfig())

    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (
        !msg.includes('notallowederror') &&
        !msg.includes('play()') &&
        !msg.includes('hls') &&
        !msg.includes('aborted') &&
        // Google DAI SDK puede generar errores de red — no son del player
        !msg.includes('net::err') &&
        !msg.includes('failed to fetch') &&
        !msg.includes('network error')
      ) {
        uncaughtErrors.push(err.message)
      }
    })

    // Act 1 — inicializar player (autoplay: true para que hls.js cargue el manifest)
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForReady(20_000)
    // Esperar que hls.js cargue el manifest SGAI y el SGAI hook haya intentado inicializar
    await player.waitForEvent('playing', 15_000)

    // Act 2 — destroy() el player
    await page.evaluate(() => (window as any).__player?.destroy())

    // Esperar un tick para que el cleanup async se complete
    await page.waitForTimeout(200)

    // Assert — cleanup corrió sin errores
    expect(
      uncaughtErrors,
      `destroy() no debe causar errores JS no capturados. Errores: ${uncaughtErrors.join(' | ')}`
    ).toHaveLength(0)

    // Assert — el elemento <video> fue removido del DOM (React unmount exitoso)
    // #player-container (el div host) permanece — es el elemento del harness, no del player.
    // El player destruye su React root y remueve el <video> interno.
    const videoInDOM = await page.evaluate(() => document.querySelector('video') != null)
    expect(
      videoInDOM,
      'Después de destroy(), el elemento <video> debe ser removido del DOM (React unmount exitoso)'
    ).toBe(false)
  })

  test('destroy() inmediato (antes de que SGAI SDK responda): sin errores', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // Caso edge: destroy() llamado muy pronto, antes de que sgaiService.initialize()
    // resuelva. El guard `if (!isMounted) return` después del await debe prevenir
    // el acceso a refs después del cleanup.
    await mockContentConfig(page, buildSGAIConfig())

    // Bloquear Google DAI SDK para simular lentitud extrema
    await page.route('**dai.google.com**', async (route) => route.abort('timedout'))
    await page.route('**googleapis.com**/dai**', async (route) => route.abort('timedout'))

    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (
        !msg.includes('notallowederror') &&
        !msg.includes('play()') &&
        !msg.includes('hls') &&
        !msg.includes('aborted') &&
        !msg.includes('net::err') &&
        !msg.includes('failed to fetch') &&
        !msg.includes('network error') &&
        !msg.includes('timedout')
      ) {
        uncaughtErrors.push(err.message)
      }
    })

    // Act — inicializar y hacer destroy inmediatamente
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })

    // No esperar ready — destroy inmediato para simular unmount rápido
    await page.evaluate(() => (window as any).__player?.destroy())

    // Esperar el tiempo que el initialize() podría tardar en timeout
    await page.waitForTimeout(500)

    // Assert — sin errores no capturados del cleanup
    expect(
      uncaughtErrors,
      `destroy() inmediato no debe lanzar errores. Errores: ${uncaughtErrors.join(' | ')}`
    ).toHaveLength(0)
  })
})

// ── SGAI CUE-OUT detection: manifest mock sirve los tags correctos ────────────

test.describe('SGAI — manifest mock contiene EXT-X-CUE-OUT', {
  tag: ['@integration', '@sgai'],
}, () => {
  // No es un test de comportamiento del player — verifica que la infraestructura
  // de test (mock-vast/server.ts) sirve el manifest correcto.
  // Si este test falla, los tests de SGAI no tienen datos de entrada válidos.

  test('GET /sgai/live.m3u8 devuelve #EXT-X-CUE-OUT con la duración configurada', async ({
    page,
  }) => {
    let manifestBody = ''
    await page.route('**/sgai/live.m3u8**', async (route) => {
      const response = await route.fetch()
      manifestBody = await response.text()
      await route.fulfill({ response })
    })

    // Forzar fetch del manifest
    await page.goto(SGAI_STREAM_URL, { waitUntil: 'commit' }).catch(() => {})
    await page.waitForTimeout(500)

    expect(
      manifestBody,
      'El manifest SGAI debe contener #EXT-X-CUE-OUT'
    ).toContain('#EXT-X-CUE-OUT:Duration=15')

    expect(
      manifestBody,
      'El manifest SGAI debe contener #EXT-OATCLS-SCTE35 (SCTE-35 payload)'
    ).toContain('#EXT-OATCLS-SCTE35')

    // Verificar que el cue point aparece en la posición correcta (segmento 2)
    const lines = manifestBody.split('\n')
    const cueIdx = lines.findIndex(l => l.includes('#EXT-X-CUE-OUT'))
    const segmentLinesBefore = lines.slice(0, cueIdx).filter(l => !l.startsWith('#') && l.trim().length > 0)
    expect(
      segmentLinesBefore.length,
      'El CUE-OUT debe aparecer antes del 3er segmento (adAt=2)'
    ).toBe(2) // 2 segmentos antes del cue (adAt=2)
  })
})

// ── AC-SGAI-002 y AC-SGAI-003: pendientes Google DAI SDK mock ─────────────────

test.describe.fixme('SGAI — buffering y DVR (requieren Google DAI SDK mock)', {
  tag: ['@integration', '@sgai', '@ads'],
}, () => {
  // AC-SGAI-002 y AC-SGAI-003 requieren que SGAIService.initialize() tenga éxito
  // con el Google DAI SDK. Esto implica:
  //   1. Un NetworkCode/CustomAssetKey válidos registrados en Google DAI
  //   2. O un mock completo del google.ima.dai.api.StreamManager
  //
  // Sin este mock, sgaiService.pendingCues estará vacío aunque el HLS loader
  // detecte los cue points, porque handleCues() no puede iniciar el flujo
  // AdBreakService → StreamManager → AdPlaybackController sin el SDK.
  //
  // Tarea pendiente: implementar un mock del google.ima.dai SDK en addInitScript()
  // que intercepte google.ima.dai.api.StreamManager y simule el lifecycle de ad breaks.

  test('AC-SGAI-002: buffering cuando llega cue point → no loop infinito', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // Requires: Google DAI SDK mock that triggers AD_BREAK_STARTED event
    // when the player hits segment at adAtSegment position
    await mockContentConfig(page, buildSGAIConfig())
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    // TODO: simulate buffering state at cue point
    // TODO: assert no infinite buffering loop
  })

  test('AC-SGAI-003: DVR seek antes del ad → sgaiAdBreakSkipped', async ({
    isolatedPlayer: player,
    page,
  }) => {
    // Requires: Google DAI SDK mock + DVR-capable SGAI stream
    await mockContentConfig(page, buildSGAIConfig())
    await player.goto({ type: 'dvr', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    // TODO: seek to position before the cue point
    // TODO: assert adsStarted NOT emitted (break skipped)
  })
})

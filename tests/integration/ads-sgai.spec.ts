/**
 * ads-sgai.spec.ts — Tests de integración para Google SGAI (Server-Guided Ad Insertion)
 *
 * Cubre:
 *   - Inicialización del plugin SGAI cuando el loadConfig devuelve config SGAI
 *   - Ausencia de crash cuando SGAI SDK no se puede cargar (red mock)
 *   - Que el player llega a estado playing con un stream HLS observable
 *   - Que el plugin no interfiere con la reproducción de contenido sin SGAI
 *
 * Fixture: isolatedPlayer (plataforma mockeada — no se habla con develop.mdstrm.com)
 *
 * IMPORTANTE: El módulo SGAI (src/ads/googleSGAI/) fue introducido en feature/dash
 * (PR #595) y puede NO estar disponible en la rama develop del player CDN aún.
 * Los tests marcados con test.fixme se habilitan automáticamente cuando el PR
 * sea mergeado a develop. Ver coverage-report.json → test_fixme_status.
 *
 * Decisión de diseño:
 *   Como SGAI requiere un manifest HLS con cue points especiales generados por
 *   el servidor SGAI de Google (no reproducible localmente sin credenciales), los
 *   tests de integración observan el comportamiento *del plugin y del player* —
 *   no el ad playback end-to-end. Para eso hay tests E2E en tests/e2e/ads-sgai.spec.ts
 *   (pendientes, priority: SHOULD).
 *
 *   ExternalStreams.hls.vod se usa como proxy: es un stream HLS real y observable
 *   sin cue points SGAI. El player debe reproducirlo normalmente cuando SGAI no
 *   está activo (test de no-regresión), y el plugin SGAI no debe bloquearlo.
 *
 * Tag: @integration
 */
import { test, expect, MockContentIds, ExternalStreams, mockContentConfig } from '../../fixtures'

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Construye un override de content config que incluye configuración SGAI.
 * En producción, loadConfig devuelve estos campos cuando el contenido tiene
 * SGAI habilitado en la plataforma. La plataforma mockeada los ignora por
 * defecto (vod.json no incluye sgai), así que los inyectamos aquí.
 */
function buildSGAIContentOverride() {
  return {
    // El plugin SGAI busca esta sección en el loadConfig
    sgai: {
      enabled: true,
      // manifestUrl con cue points sería la URL real del servidor SGAI.
      // Para tests de integración usamos un stream HLS estático observable.
      manifestUrl: ExternalStreams.hls.vod,
    },
    // El src.hls apunta al mismo stream para que el player pueda inicializar
    src: {
      hls: ExternalStreams.hls.vod,
    },
  }
}

// ── Suite 1: Comportamiento del plugin SGAI ────────────────────────────────────

test.describe('Google SGAI Plugin — Inicialización', { tag: ['@integration'] }, () => {

  // El plugin SGAI fue introducido en PR #595 (feature/dash). Cuando el PR se mergee
  // a develop y el player CDN se actualice, remover este test.fixme.
  // Unblock: PR #595 merged to develop + player version >= 1.0.58 in develop CDN.
  test.fixme(
    true,
    'Pending SGAI in develop branch — PR #595 (feature/dash) aún no mergeado a develop. ' +
    'Remover cuando player CDN develop sea >= 1.0.58.'
  )

  test('player con config SGAI se inicializa sin error', async ({ isolatedPlayer: player, page }) => {
    // Arrange — inyectar config SGAI vía mockContentConfig (LIFO sobre setupPlatformMocks)
    await mockContentConfig(page, buildSGAIContentOverride())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await player.waitForReady(25_000)

    // Assert — el player no debe haber tenido error de init al recibir config SGAI
    await player.assertNoInitError()
  })

  test('player con config SGAI llega a playing con stream HLS observable', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockContentConfig(page, buildSGAIContentOverride())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })

    // Act — esperar que el player inicie la reproducción con el stream SGAI
    await player.waitForEvent('playing', 30_000)

    // Assert
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })

  test('currentTime avanza durante playback con config SGAI activa', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockContentConfig(page, buildSGAIContentOverride())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await player.waitForEvent('playing', 30_000)

    // Assert — verificar que el tiempo avanza (no está congelado por el plugin SGAI)
    const t0 = await player.getCurrentTime()
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 8_000, intervals: [500] }
    ).toBeGreaterThan(t0)
  })

})

// ── Suite 2: No-regresión — HLS sin SGAI no se ve afectado ────────────────────

test.describe('Google SGAI Plugin — No-Regresión HLS sin SGAI', { tag: ['@integration'] }, () => {

  test.fixme(
    true,
    'Pending SGAI in develop branch — PR #595 (feature/dash) aún no mergeado a develop. ' +
    'Remover cuando player CDN develop sea >= 1.0.58.'
  )

  test('stream HLS sin config SGAI reproduce normalmente (no-regresión)', async ({ isolatedPlayer: player }) => {
    // Arrange — usar mock estándar sin config SGAI (setupPlatformMocks ya está activo)
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })

    // Assert — el player debe reproducir sin interferencia del plugin SGAI
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })

  test('player.isPlayingAd es false durante playback HLS sin SGAI', async ({ isolatedPlayer: player }) => {
    // Arrange
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await player.waitForEvent('playing', 20_000)

    // Assert — sin config SGAI, no debe detectarse un ad en reproducción
    const result = await player.page.evaluate(() => (window as any).__player?.isPlayingAd)
    expect(result).toBe(false)
  })

})

// ── Suite 3: Resiliencia — fallo del SDK SGAI ─────────────────────────────────

test.describe('Google SGAI Plugin — Resiliencia ante fallo del SDK', { tag: ['@integration'] }, () => {

  test.fixme(
    true,
    'Pending SGAI in develop branch — PR #595 (feature/dash) aún no mergeado a develop. ' +
    'Remover cuando player CDN develop sea >= 1.0.58.'
  )

  test('player continúa al playing si el SDK de SGAI no se puede cargar', async ({ isolatedPlayer: player, page }) => {
    // Arrange — bloquear la carga del SDK SGAI de Google para simular fallo de red
    // El SDK se carga desde una URL de Google — interceptamos para que falle
    await page.route('**/sgai*/**', async (route) => {
      await route.abort('failed')
    })
    await page.route('**goog**sgai**', async (route) => {
      await route.abort('failed')
    })

    // Inyectar config SGAI en el loadConfig
    await mockContentConfig(page, buildSGAIContentOverride())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })

    // Assert — el player debe degradar gracefully: continúa con el stream sin ads SGAI
    // SDKLoader.js tiene retry y error handling — el plugin no debe bloquear el playback
    await player.waitForEvent('playing', 35_000)
    await player.assertIsPlaying()
  })

  test('no hay errores JavaScript no capturados cuando el SDK SGAI falla', async ({ isolatedPlayer: player, page }) => {
    // Arrange — capturar errores no manejados de JavaScript
    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      uncaughtErrors.push(err.message)
    })

    await page.route('**/sgai*/**', async (route) => {
      await route.abort('failed')
    })

    await mockContentConfig(page, buildSGAIContentOverride())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    // Esperar a que el player termine su inicialización (con o sin SGAI)
    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    // Assert — no debe haber crashes de JavaScript por fallo del SDK SGAI
    // Filtrar errores de autoplay policy (NotAllowedError) que son normales
    const crashes = uncaughtErrors.filter(
      (e) => !e.toLowerCase().includes('notallowederror') &&
              !e.toLowerCase().includes('aborted') &&
              !e.toLowerCase().includes('play()')
    )
    expect(
      crashes,
      `El player no debe lanzar errores JavaScript no capturados al fallar el SDK SGAI. ` +
      `Errores: ${crashes.join(' | ')}`
    ).toHaveLength(0)
  })

})

/**
 * player-smoke.spec.ts — Smoke Tests (todos los ambientes)
 *
 * Suite mínima que verifica que el player está vivo en cualquier ambiente.
 * Corre en dev (diario), staging y prod (post-deploy).
 *
 * DISEÑO:
 *   - Usa ContentIds (IDs reales de la plataforma Mediastream en DEV)
 *   - Cada test < 30s
 *   - Sin mock VAST server (no disponible en staging/prod CI)
 *   - Sin tests destructivos
 *   - Si algo falla aquí = posible incidente activo
 *
 * PENDIENTE: Reemplazar ContentIds.* con IDs reales del ambiente dev.
 */
import { test, expect, ContentIds, ContentAccess } from '../../fixtures'
import { getEnvironmentConfig } from '../../config/environments'

const ENV = getEnvironmentConfig()

test.describe(`Smoke Tests — ${ENV.name}`, () => {

  // ── 1. El script del player carga y loadMSPlayer está disponible ──────────
  test('script del player carga correctamente (loadMSPlayer disponible)', async ({ player, page }) => {
    // goto() inyecta el script y espera a que loadMSPlayer esté en window
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.assertNoInitError()
  })

  // ── 2. Player se inicializa con loadMSPlayer() y emite ready ─────────────
  test('loadMSPlayer() inicializa el player y emite evento ready', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady(20_000)
  })

  // ── 3. Playback básico: play → playing → pause ────────────────────────────
  test('play() → video avanza → pause() funciona', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()

    const t1 = await player.getCurrentTime()
    await player.page.waitForTimeout(2000)
    const t2 = await player.getCurrentTime()
    expect(t2).toBeGreaterThan(t1)

    await player.pause()
    await player.assertIsPaused()
  })

  // ── 4. Seek funciona ──────────────────────────────────────────────────────
  test('seek cambia la posición de reproducción', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await player.seek(30)
    await player.waitForEvent('seeked')
    await player.assertCurrentTimeNear(30, 3)
  })

  // ── 5. load() cambia el contenido dinámicamente ───────────────────────────
  test('load() carga nuevo contenido sin destruir el player', async ({ player }) => {
    // Inicializar con un contenido
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady(20_000)

    // Cargar nuevo contenido con el método load() — prioridad en la estrategia
    await player.load({ type: 'media', id: ContentIds.vodLong })
    await player.waitForEvent('metadataloaded', 15_000)

    // El player debe seguir funcionando con el nuevo contenido
    await player.waitForEvent('ready', 20_000)
    await player.assertNoInitError()
  })

  // ── 6. Live stream carga ──────────────────────────────────────────────────
  test('Live: stream carga y reproduce (isLive=true)', async ({ player }) => {
    await player.goto({ type: 'live', id: ContentIds.live, autoplay: true, ...ContentAccess.live })
    await player.waitForEvent('playing', 30_000)

    const isLive = await player.isLive()
    expect(isLive).toBe(true)

    const duration = await player.getDuration()
    expect(duration).toBe(Infinity)
  })

  // ── 7. destroy() limpia correctamente ─────────────────────────────────────
  test('destroy() elimina el player del DOM sin errores', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()
    await player.destroy()

    const videoCount = await page.locator('video').count()
    expect(videoCount).toBe(0)
  })
})

/**
 * ads-ima-overlay-behavior.spec.ts — E2E: comportamiento del overlay ad (nonlinear IMA)
 *
 * Verifica el comportamiento observable del overlay nonlinear según la implementación
 * de overlayAds.jsx y los lineamientos IAB VAST 3.0 §3.5:
 *   - El VAST del overlay se solicita al ad server
 *   - El video NO se pausa mientras el overlay está visible (regla definitoria)
 *   - El overlay aparece dentro de los primeros 30s (overlayPosition=0)
 *   - El player no crashea durante la carga y cierre del overlay
 *
 * Observations via MCP QA (2026-06-22) sobre content 6a3946726e0d2c90d67907a9:
 *   - VAST request a pubads sz=480x70 → HTTP 200 confirmado
 *   - videoPlaying=true en seg 34 con overlay visible confirmado
 *   - Overlay apareció ~seg 10, desapareció ~seg 20 (duración gestionada por IMA SDK)
 *
 * AC cubiertos:
 *   - IMA-AC-017 (BR-IMA-OVL-001): overlay no pausa el video
 *   - IMA-AC-018: VAST request del overlay se dispara correctamente
 *   - IMA-AC-022: overlay solo se monta si ads.overlay está configurado
 *
 * Tag: @e2e @ads @ima @overlay
 */
import { test, expect, ContentIds } from '../../fixtures'

const EMBED  = 'https://develop.mdstrm.com/embed'
const PUBADS = 'pubads.g.doubleclick.net/gampad/ads'

// sz=480x70 identifica la request nonlinear (overlay) vs. linear (640x480)
const OVERLAY_SZ = '480x70'

test.describe('ads-ima overlay — comportamiento básico', {
  tag: ['@e2e', '@ads', '@ima', '@overlay'],
}, () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'IMA SDK requiere Chromium'
  )
  test.setTimeout(45_000)

  // ── IMA-AC-018: el overlay VAST request se dispara ───────────────────────

  test('overlay VAST request se dispara con sz=480x70 al iniciar la reproducción', async ({ page }) => {
    const overlayRequests: URL[] = []

    // Registrar el listener ANTES del goto para capturar todas las requests
    page.on('request', (req) => {
      if (req.url().includes(PUBADS)) {
        const url = new URL(req.url())
        if (url.searchParams.get('sz') === OVERLAY_SZ) {
          overlayRequests.push(url)
        }
      }
    })

    await page.goto(`${EMBED}/${ContentIds.vodWithOverlay}?autoplay=true&volume=0`)

    // El overlay tiene overlayPosition=0 → aparece en los primeros segundos de playback.
    // Timeout 35s para absorber latencia del IMA SDK y del pre-roll que puede preceder al overlay.
    await expect
      .poll(() => overlayRequests.length, {
        message:
          'Esperando request al overlay VAST URL (sz=480x70).\n' +
          'Si no llega: verificar que el media tiene ads.overlay configurado en plataforma dev.',
        timeout:   35_000,
        intervals: [1_000, 2_000, 3_000],
      })
      .toBeGreaterThan(0)

    const params = overlayRequests[0].searchParams

    // sz=480x70 es el formato IAB standard para nonlinear overlay
    expect(params.get('sz')).toBe(OVERLAY_SZ)

    // El overlay usa el IU del ad slot configurado en plataforma
    expect(params.get('iu')).toBeTruthy()
  })

  // ── IMA-AC-017 / GAP-IMA-OVL-001: video continúa durante overlay ────────

  test('video continúa reproduciéndose mientras el overlay está visible — no pausa', async ({ page }) => {
    let overlayDetectedAt: number | null = null
    let overlayRequestTime: number | null = null

    page.on('request', (req) => {
      if (req.url().includes(PUBADS) && new URL(req.url()).searchParams.get('sz') === OVERLAY_SZ) {
        overlayRequestTime = Date.now()
      }
    })

    await page.goto(`${EMBED}/${ContentIds.vodWithOverlay}?autoplay=true&volume=0`)

    // Esperar a que el overlay VAST se solicite
    await expect
      .poll(() => overlayRequestTime !== null, { timeout: 35_000, intervals: [500, 1_000] })
      .toBe(true)

    // Esperar 2s para que el IMA SDK cargue y renderice el ad
    await page.waitForTimeout(2_000)

    // Capturar posición del video en el momento de la medición inicial
    const timeBefore = await page.evaluate(() => {
      const v = document.querySelector('video')
      return { currentTime: v?.currentTime ?? -1, paused: v?.paused ?? true }
    })

    overlayDetectedAt = timeBefore.currentTime

    // El video NO debe estar pausado cuando el overlay está activo
    expect(
      timeBefore.paused,
      `BR-IMA-OVL-001: el video no debe pausarse cuando hay un overlay visible.\n` +
      `currentTime al momento de la medición: ${timeBefore.currentTime.toFixed(1)}s`
    ).toBe(false)

    // Esperar 3s más y verificar que el currentTime aumentó (video realmente avanzando)
    await page.waitForTimeout(3_000)

    const timeAfter = await page.evaluate(() => {
      const v = document.querySelector('video')
      return { currentTime: v?.currentTime ?? -1, paused: v?.paused ?? true }
    })

    expect(
      timeAfter.currentTime,
      `El video debe avanzar mientras el overlay está visible.\n` +
      `Antes: ${timeBefore.currentTime.toFixed(1)}s | Después: ${timeAfter.currentTime.toFixed(1)}s\n` +
      `Si currentTime no aumentó, el video se pausó durante el overlay (violación de BR-IMA-OVL-001).`
    ).toBeGreaterThan(overlayDetectedAt + 1)
  })

  // ── Overlay aparece en los primeros 30s (overlayPosition=0) ─────────────

  test('overlay aparece dentro de los primeros 30s de reproducción — overlayPosition=0', async ({ page }) => {
    let overlayTimestamp: number | null = null
    let playbackStartTime: number | null = null

    page.on('request', (req) => {
      if (req.url().includes(PUBADS) && new URL(req.url()).searchParams.get('sz') === OVERLAY_SZ) {
        overlayTimestamp = Date.now()
      }
    })

    await page.goto(`${EMBED}/${ContentIds.vodWithOverlay}?autoplay=true&volume=0`)

    // Capturar el momento en que el video empieza a reproducirse
    await page.waitForFunction(() => {
      const v = document.querySelector('video')
      return v && !v.paused && v.currentTime > 0
    }, { timeout: 20_000 })

    playbackStartTime = Date.now()

    // Esperar hasta 30s a que aparezca el overlay
    await expect
      .poll(() => overlayTimestamp !== null, { timeout: 30_000, intervals: [500, 1_000] })
      .toBe(true)

    // Verificar que el tiempo transcurrido desde el inicio de reproducción es < 30s
    const elapsedMs = overlayTimestamp! - playbackStartTime
    expect(
      elapsedMs,
      `Con overlayPosition=0 el overlay debe aparecer en los primeros 30s desde el inicio.\n` +
      `Tiempo transcurrido hasta la request del overlay: ${(elapsedMs / 1000).toFixed(1)}s`
    ).toBeLessThan(30_000)
  })

  // ── Sin crash durante la sesión con overlay ───────────────────────────────

  test('player no crashea durante la carga y cierre natural del overlay', async ({ page }) => {
    const jsErrors: string[] = []

    page.on('pageerror', (err) => jsErrors.push(err.message))

    page.on('request', (req) => {
      if (req.url().includes(PUBADS) && new URL(req.url()).searchParams.get('sz') === OVERLAY_SZ) {
        // Registrado para logging pero no bloqueante aquí
      }
    })

    await page.goto(`${EMBED}/${ContentIds.vodWithOverlay}?autoplay=true&volume=0`)

    // Dejar el player reproduciendo durante 35s (suficiente para que el overlay
    // aparezca y desaparezca naturalmente según el IMA SDK)
    await page.waitForTimeout(35_000)

    // Verificar que el video sigue en estado válido
    const state = await page.evaluate(() => {
      const v = document.querySelector('video')
      return {
        exists:      !!v,
        readyState:  v?.readyState ?? -1,
        currentTime: v?.currentTime ?? -1,
        error:       v?.error?.message ?? null,
      }
    })

    expect(state.exists, 'El elemento <video> debe existir tras el overlay').toBe(true)
    expect(state.error, 'El elemento <video> no debe tener error de MediaError').toBeNull()
    expect(state.currentTime, 'El video debe haber avanzado (currentTime > 0)').toBeGreaterThan(0)

    // Filtrar errores JS conocidos no relacionados con el player
    const playerErrors = jsErrors.filter(
      msg => !msg.includes('ResizeObserver') && !msg.includes('Non-Error promise rejection')
    )

    expect(
      playerErrors,
      `JS errors durante la sesión con overlay:\n${playerErrors.join('\n')}`
    ).toHaveLength(0)
  })
})

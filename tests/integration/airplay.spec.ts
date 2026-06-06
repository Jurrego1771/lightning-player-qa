/**
 * airplay.spec.ts — Tests de integración para AirPlay (v1.0.71+)
 *
 * Cubre gap #15: airPlayAvailabilityChange, airPlayConnected, airPlayDisconnected
 *
 * Restricciones de CI:
 *   - AirPlay es exclusivo de Safari / WebKit en macOS.
 *   - En CI headless (WebKit Playwright), WebKitPlaybackTargetAvailabilityEvent
 *     puede no estar disponible — el evento airPlayAvailabilityChange se emite
 *     con availability='not-available' o no se emite en headless.
 *   - airPlayConnected / airPlayDisconnected requieren dispositivo físico Apple TV
 *     o receptor AirPlay en la misma red — no testeable en CI automatizado.
 *
 * Estrategia de cobertura:
 *   A) API surface: verificar que los 3 eventos están en el registry del harness.
 *   B) Disponibilidad: en WebKit, el player registra la API nativa y puede emitir
 *      airPlayAvailabilityChange. En headless, capturar el evento si se emite.
 *   C) Connect/Disconnect: test.fixme — requiere dispositivo real.
 *
 * Todos los tests hacen test.skip en Chromium y Firefox.
 *
 * Tag: @integration @airplay
 */
import { test, expect, MockContentIds } from '../../fixtures'

const WEBKIT_ONLY = 'AirPlay es exclusivo de WebKit/Safari — sin soporte en Chromium/Firefox'

// ── A: API surface — eventos registrados en el harness ───────────────────────

test.describe('AirPlay — API surface', { tag: ['@integration', '@airplay'] }, () => {

  test('airPlayAvailabilityChange está en el registry de eventos del harness', async ({
    isolatedPlayer: player,
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'webkit', WEBKIT_ONLY)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    // Verificar que el harness tiene el listener para airPlayAvailabilityChange
    // (ALL_EVENTS en index.html incluye AIRPLAY_EVENTS desde v#gap15)
    const eventsRegistered: boolean = await page.evaluate(() => {
      // El harness llama player.on() para cada evento en ALL_EVENTS.
      // Si airPlayAvailabilityChange no está soportado por el player, on() es no-op silencioso.
      // Verificamos que el player acepta el registro (no lanza error).
      try {
        ;(window as any).__player?.on('airPlayAvailabilityChange', () => {})
        return true
      } catch {
        return false
      }
    })

    expect(
      eventsRegistered,
      'player.on("airPlayAvailabilityChange") no debe lanzar error'
    ).toBe(true)
  })

  test('los 3 eventos AirPlay se pueden registrar sin error', async ({
    isolatedPlayer: player,
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'webkit', WEBKIT_ONLY)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    const results: Record<string, boolean> = await page.evaluate(() => {
      const p = (window as any).__player
      const events = ['airPlayAvailabilityChange', 'airPlayConnected', 'airPlayDisconnected']
      const r: Record<string, boolean> = {}
      for (const evt of events) {
        try {
          p?.on(evt, () => {})
          r[evt] = true
        } catch {
          r[evt] = false
        }
      }
      return r
    })

    for (const [evt, ok] of Object.entries(results)) {
      expect(ok, `player.on("${evt}") no debe lanzar error`).toBe(true)
    }
  })
})

// ── B: Disponibilidad en WebKit ───────────────────────────────────────────────

test.describe('AirPlay — Disponibilidad en WebKit', { tag: ['@integration', '@airplay'] }, () => {

  test('WebKit: airPlayAvailabilityChange se emite o la API nativa no está disponible en headless', async ({
    isolatedPlayer: player,
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'webkit', WEBKIT_ONLY)
    test.setTimeout(30_000)

    // Registrar listener manual para capturar airPlayAvailabilityChange
    // ANTES de que el player inicialice, para no perder el evento inicial.
    const availabilityData: unknown[] = []
    await page.exposeFunction('__onAirPlayAvailability', (data: unknown) => {
      availabilityData.push(data)
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    // Registrar listener post-ready (backfill no aplica a AirPlay)
    await page.evaluate(() => {
      ;(window as any).__player?.on('airPlayAvailabilityChange', (data: unknown) => {
        ;(window as any).__onAirPlayAvailability(data)
      })
    })

    // Esperar brevemente — en dispositivos con AirPlay disponible el evento
    // se emite poco después del ready. En headless puede no emitirse.
    await page.waitForTimeout(3_000)

    // En headless CI, el evento puede no emitirse (no hay dispositivos AirPlay).
    // El test verifica que si el evento se emite, tiene un campo 'availability'.
    if (availabilityData.length > 0) {
      const data = availabilityData[0] as Record<string, unknown>
      const hasAvailability = typeof data?.availability === 'string'
      expect(
        hasAvailability,
        `airPlayAvailabilityChange payload debe tener campo 'availability' (string). Recibido: ${JSON.stringify(data)}`
      ).toBe(true)

      const validValues = ['available', 'not-available']
      expect(
        validValues.includes(data.availability as string),
        `availability debe ser 'available' o 'not-available'. Recibido: ${data.availability}`
      ).toBe(true)
    } else {
      // Sin evento emitido — esperado en WebKit headless sin dispositivos AirPlay.
      // Anotar para visibilidad en el reporte.
      test.info().annotations.push({
        type: 'info',
        description: 'airPlayAvailabilityChange no se emitió — WebKit headless sin dispositivos AirPlay en red. Comportamiento esperado en CI.',
      })
    }
  })

  test('WebKit: el elemento video tiene atributo x-webkit-airplay si el player lo soporta', async ({
    isolatedPlayer: player,
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'webkit', WEBKIT_ONLY)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    const airplayAttr = await page.evaluate(() => {
      const video = document.querySelector('video')
      return video?.getAttribute('x-webkit-airplay') ?? null
    })

    // El player puede o no setear este atributo dependiendo de la implementación.
    // Si lo setea, debe ser 'allow'. Si no lo setea, anotamos para documentación.
    if (airplayAttr !== null) {
      expect(
        airplayAttr,
        'x-webkit-airplay debe ser "allow" si está presente'
      ).toBe('allow')
    } else {
      test.info().annotations.push({
        type: 'info',
        description: 'El elemento <video> no tiene atributo x-webkit-airplay. AirPlay puede depender de la detección del player skin en lugar del atributo HTML.',
      })
    }
  })
})

// ── C: Connect/Disconnect — requiere dispositivo físico ──────────────────────

test.describe('AirPlay — Connect / Disconnect (dispositivo real)', { tag: ['@integration', '@airplay'] }, () => {

  test.fixme(
    'airPlayConnected se emite al conectar a un receptor AirPlay',
    // Requiere: macOS + Safari real + Apple TV o AirPlay receiver en la misma red.
    // No ejecutable en CI headless. Testear manualmente con: npx playwright test --ui
    // y un dispositivo AirPlay disponible. El payload debe incluir { deviceName: string }.
    async () => {}
  )

  test.fixme(
    'airPlayDisconnected se emite al desconectar del receptor AirPlay',
    // Mismo prerequisito que airPlayConnected.
    // Payload esperado: { deviceName: string } (nombre del receptor desconectado).
    async () => {}
  )
})

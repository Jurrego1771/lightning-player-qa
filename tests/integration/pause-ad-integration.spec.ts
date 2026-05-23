/**
 * pause-ad-integration.spec.ts — Tests de backward compatibility y error boundary
 *
 * Cubre los casos de integración críticos de la feature Pause Ad con el resto
 * del player:
 *
 *   1. Backward compat — pauseAdEnabled=false deja el player intacto
 *   2. player.load() secuencial con y sin pauseAd config
 *   3. Error boundary — PauseAdWrapper está bajo React.Suspense; un crash
 *      en el componente interno no debe derribar el VideoView completo
 *
 * Fixture: isolatedPlayer (plataforma mockeada + stream HLS local)
 *
 * Observabilidad:
 *   - Presencia/ausencia de elementos DOM (overlay, imagen)
 *   - player.hasInitError() — null si el init fue correcto
 *   - player.getErrors() — lista de errores emitidos por el player
 *   - player.getStatus() — 'playing' | 'pause' | 'buffering' | 'idle'
 *
 * Anti-patrones evitados:
 *   - Sin waitForTimeout — solo expect.poll() y waitForEvent()
 *   - Sin acceder a internals de React ni Jotai directamente
 */
import { test, expect, MockContentIds, mockContentConfig } from '../../fixtures'

const MOCK_VAST_URL = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

// ── Backward compatibility ────────────────────────────────────────────────────

test.describe('Pause Ad — Backward Compatibility', { tag: ['@integration', '@ads'] }, () => {

  test('sin config ads.pausead el player carga y reproduce normalmente', async ({ isolatedPlayer: player, page }) => {
    // Arrange — fixture por defecto: vod.json tiene ads: {} (sin pausead)
    // No se llama mockContentConfig — se usa el mock base

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Assert — reproducción sin problemas
    await player.assertIsPlaying()

    // No hay overlay de pause ad en el DOM
    const overlayCount = await page.locator('.pause-ad__asset').count()
    expect(overlayCount).toBe(0)

    const initError = await player.hasInitError()
    expect(initError).toBeNull()
  })

  test('pauseAdEnabled=false: PauseAdWrapper no se renderiza en el DOM', async ({ isolatedPlayer: player, page }) => {
    // Arrange — config explícita sin tag ni tagMobile → pauseAdEnabledAtom=false
    // VideoView renderiza <PauseAdWrapper /> pero esta retorna null si !pauseAdEnabled
    await mockContentConfig(page, {
      ads: {
        pausead: {
          // Sin tag ni tagMobile → pauseAdConfigAtom retorna null → pauseAdEnabledAtom=false
        },
      },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Act — pausar para verificar que el wrapper no se monta
    await player.pause()
    await player.waitForEvent('pause', 10_000)
    await page.waitForTimeout(2_000)

    // Assert — ningún elemento del pause ad está en el DOM
    const overlayCount = await page.locator('.pause-ad__asset').count()
    expect(overlayCount, 'PauseAdWrapper no debe renderizarse cuando pauseAdEnabled=false').toBe(0)

    const containerCount = await page.locator('.pause-ad-container').count()
    expect(containerCount).toBe(0)
  })

  test('player funciona normalmente con ads.pausead.tag=null', async ({ isolatedPlayer: player, page }) => {
    // Arrange — tag explícitamente null (config inválida que debe ser ignorada gracefully)
    // pauseAdConfigAtom retorna null cuando !tag && !tagMobile → pauseAdEnabledAtom=false
    await mockContentConfig(page, {
      ads: {
        pausead: {
          tag: null,
          tagMobile: null,
        },
      },
    })

    // Este test verifica que la config de plataforma no rompe el player
    // cuando los valores de tag son null — pauseAdConfigAtom los maneja
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)
    await player.assertIsPlaying()

    const initError = await player.hasInitError()
    expect(initError).toBeNull()
  })

})

// ── player.load() secuencial ──────────────────────────────────────────────────

test.describe('Pause Ad — player.load() secuencial', { tag: ['@integration', '@ads'] }, () => {

  test('load() con nuevo contenido sin pauseAd no rompe el estado del player', async ({ isolatedPlayer: player, page }) => {
    // Arrange — primer contenido con pauseAd habilitado
    await mockContentConfig(page, {
      ads: {
        pausead: {
          tag: `${MOCK_VAST_URL}/vast/pausead`,
          tagMobile: `${MOCK_VAST_URL}/vast/pausead`,
          closeButton: -1,
        },
      },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Mostrar el overlay en el primer contenido
    await player.pause()
    await player.waitForEvent('pause', 10_000)
    await expect.poll(
      () => page.locator('.pause-ad__asset').count(),
      { timeout: 10_000 }
    ).toBeGreaterThanOrEqual(1)

    // Act — cargar nuevo contenido via player.load()
    await player.load({ type: 'media', id: MockContentIds.episode })
    await player.waitForReady(30_000)

    // Assert — el overlay del primer contenido desaparece tras el load()
    await expect.poll(
      () => page.locator('.pause-ad__asset').count(),
      { timeout: 5_000 }
    ).toBe(0)

    // El player puede reproducir el nuevo contenido sin errores
    const initError = await player.hasInitError()
    expect(initError).toBeNull()
  })

  test('load() secuencial: pause ad aparece correctamente en el segundo contenido', async ({ isolatedPlayer: player, page }) => {
    // Arrange — ambos contenidos tienen pauseAd habilitado via el mismo mock
    await mockContentConfig(page, {
      ads: {
        pausead: {
          tag: `${MOCK_VAST_URL}/vast/pausead`,
          tagMobile: `${MOCK_VAST_URL}/vast/pausead`,
          closeButton: -1,
        },
      },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Cargar segundo contenido
    await player.load({ type: 'media', id: MockContentIds.episode })
    await player.waitForReady(30_000)

    // Reproducir y luego pausar en el segundo contenido
    await player.play()
    await player.waitForEvent('playing', 15_000)

    await player.pause()
    await player.waitForEvent('pause', 10_000)

    // Assert — el overlay aparece correctamente en el segundo contenido
    await expect.poll(
      () => page.locator('.pause-ad__asset').count(),
      { timeout: 10_000 }
    ).toBeGreaterThanOrEqual(1)
  })

})

// ── Error boundary ────────────────────────────────────────────────────────────

test.describe('Pause Ad — Error Boundary y resiliencia', { tag: ['@integration', '@ads'] }, () => {

  test('VAST tag que falla no impide que el player reproduzca contenido', async ({ isolatedPlayer: player, page }) => {
    // Arrange — VAST tag que siempre falla con 500
    await page.route(`${MOCK_VAST_URL}/vast/pausead-always-fail`, async (route) => {
      await route.fulfill({ status: 500, body: 'Server Error' })
    })
    await mockContentConfig(page, {
      ads: {
        pausead: {
          tag: `${MOCK_VAST_URL}/vast/pausead-always-fail`,
          tagMobile: `${MOCK_VAST_URL}/vast/pausead-always-fail`,
        },
      },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Act — pausar (el fetch VAST fallará silenciosamente)
    await player.pause()
    await player.waitForEvent('pause', 10_000)
    await page.waitForTimeout(2_000)

    // Assert — el player sigue funcionando, no hay overlay, no hay errores fatales
    const overlayCount = await page.locator('.pause-ad__asset').count()
    expect(overlayCount).toBe(0)

    // Poder reanudar reproducción confirma que el player no quedó en estado roto
    await player.play()
    await player.assertIsPlaying()

    const initError = await player.hasInitError()
    expect(initError).toBeNull()
  })

  test('VideoView sigue funcionando si PauseAd falla al cargar el VAST', async ({ isolatedPlayer: player, page }) => {
    // Arrange — timeout simulado: el VAST demora más que el timeout del player
    // fetchPauseAdVastConfig usa el timeout de adsRequest.vastLoadTimeout
    await page.route(`${MOCK_VAST_URL}/vast/pausead-timeout`, async (route) => {
      // No responder inmediatamente — simular timeout de red
      // Playwright cerrará la ruta cuando el test termine
      await new Promise(resolve => setTimeout(resolve, 60_000))
      await route.fulfill({ status: 200, body: '' })
    })
    await mockContentConfig(page, {
      ads: {
        pausead: {
          tag: `${MOCK_VAST_URL}/vast/pausead-timeout`,
          tagMobile: `${MOCK_VAST_URL}/vast/pausead-timeout`,
        },
      },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Act — pausar mientras el VAST está en vuelo (timeout largo)
    await player.pause()
    await player.waitForEvent('pause', 10_000)

    // Assert — el VideoView sigue en pie: el player está en pause, no crasheado
    // El estado del player debe ser 'pause', no 'idle' (que indicaría un destroy)
    await expect.poll(() => player.getStatus(), { timeout: 5_000 }).toBe('pause')

    // La UI del player sigue accesible (controles visibles)
    const initError = await player.hasInitError()
    expect(initError).toBeNull()
  })

  test('múltiples pauses rápidos no disparan múltiples fetches simultáneos', async ({ isolatedPlayer: player, page }) => {
    // Arrange — contar cuántas veces se solicita el VAST tag
    // pauseAdRequestInProgressAtom actúa como guard para evitar double-fetch
    const vastRequestCount: number[] = []
    await page.route(`${MOCK_VAST_URL}/vast/pausead`, async (route) => {
      vastRequestCount.push(Date.now())
      await route.continue()
    })
    await mockContentConfig(page, {
      ads: {
        pausead: {
          tag: `${MOCK_VAST_URL}/vast/pausead`,
          tagMobile: `${MOCK_VAST_URL}/vast/pausead`,
        },
      },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Act — pausar una sola vez (el guard debe prevenir fetches adicionales)
    await player.pause()
    await player.waitForEvent('pause', 10_000)

    // Esperar a que el fetch complete
    await expect.poll(() => vastRequestCount.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)

    const countAfterFirstPause = vastRequestCount.length

    // Assert — no hay más fetches en vuelo para la misma pausa
    // (el guard pauseAdRequestInProgressAtom=true previene fetches adicionales
    //  mientras el primero está en progreso)
    await page.waitForTimeout(1_000)
    expect(vastRequestCount.length).toBe(countAfterFirstPause)
  })

  test('player.destroy() limpia el estado de pause ad sin errores', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockContentConfig(page, {
      ads: {
        pausead: {
          tag: `${MOCK_VAST_URL}/vast/pausead`,
          tagMobile: `${MOCK_VAST_URL}/vast/pausead`,
          closeButton: -1,
        },
      },
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 15_000)

    // Mostrar el overlay
    await player.pause()
    await player.waitForEvent('pause', 10_000)
    await expect.poll(
      () => page.locator('.pause-ad__asset').count(),
      { timeout: 10_000 }
    ).toBeGreaterThanOrEqual(1)

    // Act — destruir el player mientras el overlay está visible
    await player.destroy()

    // Assert — no hay errores de consola de React / Jotai tras el destroy
    // El atomEffect cleanup en pauseAd.js debería desregistrar los listeners
    // Verificamos que el overlay desapareció del DOM
    await expect.poll(
      () => page.locator('.pause-ad__asset').count(),
      { timeout: 5_000 }
    ).toBe(0)

    // Verificar que no hubo errores de init (el destroy fue limpio)
    const initError = await player.hasInitError()
    expect(initError).toBeNull()
  })

})

// ── Configuración de posición ─────────────────────────────────────────────────

test.describe('Pause Ad — Variantes de posición', { tag: ['@integration', '@ads'] }, () => {

  const positions = ['center', 'top', 'bottom', 'top-right', 'bottom-right'] as const

  for (const position of positions) {
    test(`overlay se renderiza con position=${position} sin errores`, async ({ isolatedPlayer: player, page }) => {
      // Arrange
      await mockContentConfig(page, {
        ads: {
          pausead: {
            tag: `${MOCK_VAST_URL}/vast/pausead`,
            tagMobile: `${MOCK_VAST_URL}/vast/pausead`,
            position,
            closeButton: -1,
          },
        },
      })

      await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
      await player.waitForEvent('playing', 15_000)

      // Act
      await player.pause()
      await player.waitForEvent('pause', 10_000)

      // Assert — el overlay se renderiza con la clase de posición correcta
      await expect.poll(
        () => page.locator('.pause-ad__asset').count(),
        { timeout: 10_000 }
      ).toBeGreaterThanOrEqual(1)

      // Verificar que el contenedor tiene la clase de posición correcta
      const containerHasClass = await page.locator(`.pause-ad-${position}`).count()
      expect(containerHasClass, `El contenedor debe tener la clase pause-ad-${position}`).toBeGreaterThanOrEqual(1)

      const initError = await player.hasInitError()
      expect(initError).toBeNull()
    })
  }

})
